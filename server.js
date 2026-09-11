const express=require("express");
const {createClient}=require("@supabase/supabase-js");
const bcrypt=require("bcryptjs");
const jwt=require("jsonwebtoken");
const rateLimit=require("express-rate-limit");
const twilio=require("twilio");
const path=require("path");

const app=express();
app.use(express.json({limit:"20mb"}));
app.use(express.urlencoded({extended:false}));
app.use(express.static(path.join(__dirname,"public")));
app.use(rateLimit({windowMs:15*60*1000,max:500}));

const PORT=process.env.PORT||10000;
const URL=process.env.SUPABASE_URL;
const KEY=process.env.SUPABASE_SERVICE_ROLE_KEY||process.env.SUPABASE_SECRET_KEY||process.env.SUPABASE_KEY;
const JWT=process.env.JWT_SECRET||"change-this-secret";
const OWNER=process.env.OWNER_KEY||"change-owner-key";
const BUCKET=process.env.SUPABASE_BUCKET||"jr-pheef";
const sb=createClient(URL,KEY);
const tw=process.env.TWILIO_ACCOUNT_SID?twilio(process.env.TWILIO_ACCOUNT_SID,process.env.TWILIO_AUTH_TOKEN):null;

const money=n=>Number(n||0).toLocaleString("en-KE");
const phone=x=>String(x||"").replace(/^whatsapp:/i,"").trim();
const clean=x=>String(x||"").trim();
const token=u=>jwt.sign({id:u.id,role:u.role||"user"},JWT,{expiresIn:"30d"});
const esc=x=>String(x||"").replace(/[&<>"]/g,a=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;"}[a]));
const twiml=x=>`<Response><Message>${esc(x)}</Message></Response>`;

async function user(id){
 const {data}=await sb.from("members").select("*").eq("id",id).maybeSingle();
 return data;
}
async function auth(req,res,next){
 try{
  const h=req.headers.authorization||"";
  if(!h.startsWith("Bearer "))throw 0;
  const x=jwt.verify(h.slice(7),JWT);
  if(x.role==="owner"){req.user={id:"OWNER",role:"owner",name:"ROBERT"};return next();}
  req.user=await user(x.id);
  if(!req.user)throw 0;
  next();
 }catch{res.status(401).json({error:"Login required"});}
}
const owner=(req,res,next)=>req.user?.role==="owner"?next():res.status(403).json({error:"Owner only"});

function contactBlocked(v){
 const s=clean(v).toLowerCase();
 return /(\+?\d[\d\s().-]{7,}\d|(?:zero|oh|o)\s*(?:one|1)\s*(?:two|2)|whatsapp|telegram|signal|call\s+me|text\s+me|dm\s+me|email\s+me|@\s*(gmail|yahoo|outlook)|\b[\w.+-]+@[\w-]+\.[a-z]{2,}\b|instagram|tiktok|facebook|snapchat)/i.test(s);
}
function safeText(v){
 if(contactBlocked(v))throw Error("Contact information is not allowed here. Use JR PHEEF CHAT.");
 return clean(v);
}
function km(a,b,c,d){
 const R=6371,rad=x=>x*Math.PI/180;
 const x=rad(c-a),y=rad(d-b);
 return R*2*Math.asin(Math.sqrt(Math.sin(x/2)**2+Math.cos(rad(a))*Math.cos(rad(c))*Math.sin(y/2)**2));
}
async function log(userId,action,table="",record="",details={}){
 await sb.from("audit_logs").insert({owner_id:userId==="OWNER"?null:userId,action,table_name:table,record_id:record,details});
}
async function wallet(id){
 const {data}=await sb.from("wallet_transactions").select("amount,type").eq("user_id",id);
 let cash=0,credits=0;
 (data||[]).forEach(x=>{
  const n=Number(x.amount||0);
  if(["GROWTH_CREDIT","CREDIT"].includes(x.type))credits+=n;else cash+=n;
 });
 return {cash,credits};
}
async function upload(file,userId,folder="uploads"){
 const m=String(file||"").match(/^data:(.+);base64,(.+)$/);
 if(!m)throw Error("Invalid file");
 const ext=(m[1].split("/")[1]||"bin").split(";")[0];
 const name=`${folder}/${userId}/${Date.now()}-${Math.random().toString(36).slice(2)}.${ext}`;
 const {error}=await sb.storage.from(BUCKET).upload(name,Buffer.from(m[2],"base64"),{contentType:m[1],upsert:false});
 if(error)throw error;
 return sb.storage.from(BUCKET).getPublicUrl(name).data.publicUrl;
}

/* HEALTH */
app.get("/",(q,r)=>r.json({app:"JR PHEEF",tagline:"Find. Match. Trade.",status:"LIVE"}));
app.get("/api/health",(q,r)=>r.json({ok:true,time:new Date().toISOString()}));

/* AUTH */
app.post("/api/auth/signup",async(req,res)=>{
 try{
  const {name,email,password,phone,birth_year,terms_agreed}=req.body;
  if(!name||!email||!password||!phone||!birth_year||!terms_agreed)return res.status(400).json({error:"Complete signup and accept Terms."});
  const exists=await sb.from("members").select("id").or(`email.eq.${email},phone.eq.${phone}`).maybeSingle();
  if(exists.data)return res.status(409).json({error:"Account already exists."});
  const referral_code="JRP-"+Math.random().toString(36).slice(2,8).toUpperCase();
  const hash=await bcrypt.hash(password,10);
  const {data,error}=await sb.from("members").insert({
   name,email:email.toLowerCase(),phone,password_hash:hash,birth_year,
   role:"user",membership:"FREE+",referral_code,
   terms_agreed_at:new Date().toISOString()
  }).select().single();
  if(error)throw error;
  await log(data.id,"SIGNUP","members",data.id);
  res.json({token:token(data),user:data});
 }catch(e){res.status(400).json({error:e.message});}
});

app.post("/api/auth/login",async(req,res)=>{
 try{
  const {email,password}=req.body;
  const {data}=await sb.from("members").select("*").eq("email",String(email).toLowerCase()).maybeSingle();
  if(!data||!(await bcrypt.compare(password,data.password_hash)))return res.status(401).json({error:"Invalid login"});
  await sb.from("members").update({last_active_at:new Date().toISOString()}).eq("id",data.id);
  res.json({token:token(data),user:data});
 }catch(e){res.status(400).json({error:e.message});}
});

/* GOOGLE */
app.get("/api/auth/google",async(req,res)=>{
 try{
  const {data,error}=await sb.auth.signInWithOAuth({
   provider:"google",
   options:{redirectTo:process.env.GOOGLE_REDIRECT_URL||`${req.protocol}://${req.get("host")}/api/auth/callback`}
  });
  if(error)throw error;
  res.redirect(data.url);
 }catch(e){res.status(400).json({error:e.message});}
});
app.get("/api/auth/callback",(req,res)=>res.redirect("/?google=complete"));

app.get("/api/me",auth,async(req,res)=>res.json({user:req.user,wallet:await wallet(req.user.id)}));

/* STORAGE */
app.post("/api/upload",auth,async(req,res)=>{
 try{
  const url=await upload(req.body.file,req.user.id,req.body.folder||"uploads");
  res.json({url});
 }catch(e){res.status(400).json({error:e.message});}
});

/* MARKETPLACE */
app.get("/api/listings",auth,async(req,res)=>{
 const q=clean(req.query.q);
 let x=sb.from("listings").select("*").eq("status","ACTIVE").order("created_at",{ascending:false}).limit(100);
 if(q)x=x.or(`title.ilike.%${q}%,description.ilike.%${q}%,category.ilike.%${q}%`);
 const {data,error}=await x;
 res.json({data:data||[],error:error?.message});
});
app.post("/api/listings",auth,async(req,res)=>{
 try{
  const {title,description,price,location,country,category,images=[],lat,lng}=req.body;
  if(Number(price)<=100)throw Error("Minimum listing price is above KSh 100.");
  if(images.length<3||images.length>20)throw Error("Upload 3 to 20 photos.");
  safeText(title);safeText(description);safeText(location);
  const {data,error}=await sb.from("listings").insert({
   user_id:req.user.id,title,description,price,location,country,category,
   images,status:"ACTIVE",lat,lng
  }).select().single();
  if(error)throw error;
  await log(req.user.id,"CREATE","listings",data.id);
  res.json(data);
 }catch(e){res.status(400).json({error:e.message});}
});
app.patch("/api/listings/:id",auth,async(req,res)=>{
 const {data,error}=await sb.from("listings").update(req.body).eq("id",req.params.id).eq("user_id",req.user.id).select().single();
 res.status(error?400:200).json(error?{error:error.message}:data);
});
app.delete("/api/listings/:id",auth,async(req,res)=>{
 const {error}=await sb.from("listings").update({status:"DELETED"}).eq("id",req.params.id).eq("user_id",req.user.id);
 res.json({ok:!error,error:error?.message});
});

/* NEARBY MATCHING */
app.get("/api/match/nearby",auth,async(req,res)=>{
 const lat=Number(req.query.lat),lng=Number(req.query.lng),limit=Number(req.query.limit||50);
 const radii=[.01,.025,.05,.1,.25,.5,1,5,10,25,50,100,500];
 const {data}=await sb.from("listings").select("*").eq("status","ACTIVE").limit(500);
 const out=[];
 for(const radius of radii){
  for(const x of data||[]){
   if(x.lat==null||x.lng==null||out.some(a=>a.id===x.id))continue;
   const d=km(lat,lng,Number(x.lat),Number(x.lng));
   if(d<=radius)out.push({...x,distance_km:d});
  }
  if(out.length>=limit)break;
 }
 res.json(out.slice(0,limit));
});

/* CONTACT SHIELD */
app.post("/api/safety/check",auth,(req,res)=>{
 const blocked=contactBlocked(req.body.text);
 res.json({allowed:!blocked,message:blocked?"Contact information is blocked. Use JR PHEEF tools.":"OK"});
});

/* SHORTS */
app.get("/api/shorts",auth,async(req,res)=>{
 const {data,error}=await sb.from("shorts").select("*").eq("status","PUBLISHED").order("created_at",{ascending:false}).limit(50);
 res.json({data:data||[],error:error?.message});
});
app.post("/api/shorts",auth,async(req,res)=>{
 try{
  const {video_url,caption,category,listing_id,ad_id}=req.body;
  if(!video_url)throw Error("Video required.");
  safeText(caption);
  const {data,error}=await sb.from("shorts").insert({
   user_id:req.user.id,video_url,caption,category,listing_id,ad_id,status:"REVIEW"
  }).select().single();
  if(error)throw error;
  await log(req.user.id,"SHORT_REVIEW","shorts",data.id);
  res.json({message:"Short submitted for safety review.",short:data});
 }catch(e){res.status(400).json({error:e.message});}
});

/* TALENT / FREELANCERS */
app.get("/api/talent",auth,async(req,res)=>{
 const {data,error}=await sb.from("workers").select("*").order("rating",{ascending:false}).limit(100);
 res.json({data:data||[],error:error?.message});
});
app.post("/api/talent",auth,async(req,res)=>{
 const {skills,location,experience,availability}=req.body;
 const {data,error}=await sb.from("workers").upsert({
  user_id:req.user.id,skills,location,experience,availability
 }).select().single();
 res.status(error?400:200).json(error?{error:error.message}:data);
});

/* WORK */
app.post("/api/tasks",auth,async(req,res)=>{
 try{
  const {title,description,location,budget,skill,urgency}=req.body;
  safeText(title);safeText(description);safeText(location);
  const {data,error}=await sb.from("tasks").insert({
   owner_id:req.user.id,title,description,location,budget,skill,urgency,status:"MATCHING"
  }).select().single();
  if(error)throw error;
  res.json(data);
 }catch(e){res.status(400).json({error:e.message});}
});
app.get("/api/tasks",auth,async(req,res)=>{
 const {data,error}=await sb.from("tasks").select("*").or(`owner_id.eq.${req.user.id},worker_id.eq.${req.user.id}`).order("created_at",{ascending:false});
 res.json({data:data||[],error:error?.message});
});

/* DEAL ROOMS */
app.post("/api/deals",auth,async(req,res)=>{
 const {seller_id,listing_id,task_id}=req.body;
 if(seller_id===req.user.id)return res.status(400).json({error:"You cannot connect with yourself."});
 const {data,error}=await sb.from("deal_rooms").insert({
  buyer_id:req.user.id,seller_id,listing_id,task_id,status:"OPEN"
 }).select().single();
 res.status(error?400:200).json(error?{error:error.message}:data);
});
app.get("/api/deals",auth,async(req,res)=>{
 const {data,error}=await sb.from("deal_rooms").select("*").or(`buyer_id.eq.${req.user.id},seller_id.eq.${req.user.id}`).order("created_at",{ascending:false});
 res.json({data:data||[],error:error?.message});
});
app.get("/api/deals/:id/messages",auth,async(req,res)=>{
 const {data,error}=await sb.from("messages").select("*").eq("room_id",req.params.id).order("created_at");
 res.json({data:data||[],error:error?.message});
});
app.post("/api/deals/:id/messages",auth,async(req,res)=>{
 try{
  const message=safeText(req.body.message);
  const {data:room}=await sb.from("deal_rooms").select("*").eq("id",req.params.id).single();
  if(!room||![room.buyer_id,room.seller_id].includes(req.user.id))throw Error("Not a Deal Room member.");
  const {data,error}=await sb.from("messages").insert({room_id:room.id,sender_id:req.user.id,message}).select().single();
  if(error)throw error;
  res.json(data);
 }catch(e){res.status(400).json({error:e.message});}
});

/* CONNECTION PAYMENT */
app.post("/api/connections",auth,async(req,res)=>{
 const amount=Number(req.body.amount||30);
 const {data,error}=await sb.from("connections").insert({
  room_id:req.body.room_id,user_id:req.user.id,amount,status:"PENDING"
 }).select().single();
 res.status(error?400:200).json(error?{error:error.message}:data);
});

/* WALLET */
app.get("/api/wallet",auth,async(req,res)=>{
 const w=await wallet(req.user.id);
 const {data:tx}=await sb.from("wallet_transactions").select("*").eq("user_id",req.user.id).order("created_at",{ascending:false});
 res.json({...w,transactions:tx||[]});
});
app.post("/api/withdraw",auth,async(req,res)=>{
 const amount=Number(req.body.amount);
 if(amount<200)return res.status(400).json({error:"Minimum withdrawal is KSh 200."});
 const w=await wallet(req.user.id);
 if(amount>w.cash)return res.status(400).json({error:"Insufficient withdrawable balance."});
 const {data,error}=await sb.from("withdrawals").insert({
  user_id:req.user.id,amount,phone:req.body.phone,status:"PENDING"
 }).select().single();
 res.status(error?400:200).json(error?{error:error.message}:{message:"Withdrawal submitted for processing.",withdrawal:data});
});

/* INVESTMENT */
app.get("/api/invest",auth,async(req,res)=>{
 const {data:products}=await sb.from("investment_products").select("*").order("name");
 const {data:holdings}=await sb.from("investment_holdings").select("*").eq("user_id",req.user.id);
 const w=await wallet(req.user.id);
 res.json({
  growth_credits:w.credits,
  products:products||[],
  holdings:holdings||[],
  locked_markets:["NSE","GLOBAL_STOCKS","ETFS","FUNDS","BONDS","OTHER"]
 });
});
app.post("/api/invest/buy",auth,async(req,res)=>{
 try{
  const amount=Number(req.body.amount),productId=req.body.product_id;
  if(amount<=0)throw Error("Invalid amount.");
  const w=await wallet(req.user.id);
  if(amount>w.credits)throw Error("Insufficient JR PHEEF Growth Credits.");
  const {data:p}=await sb.from("investment_products").select("*").eq("id",productId).single();
  if(!p||!p.active||p.status!=="ACTIVE")throw Error("Investment product inactive.");
  if(!p.allow_wallet_credits)throw Error("Wallet credits are not enabled for this product.");
  if(amount<Number(p.min_investment||1))throw Error("Below minimum investment.");
  const units=amount/Number(p.unit_price);
  const {data:t,error}=await sb.from("investment_transactions").insert({
   user_id:req.user.id,product_id:productId,type:"BUY",amount,units,
   price:p.unit_price,status:"APPROVED",reference:"INV-"+Date.now()
  }).select().single();
  if(error)throw error;
  await sb.from("wallet_transactions").insert({
   user_id:req.user.id,amount:-amount,type:"INVESTMENT_PURCHASE",
   description:`Investment in ${p.name}`,reference:t.reference
  });
  const {data:h}=await sb.from("investment_holdings").select("*").eq("user_id",req.user.id).eq("product_id",productId).maybeSingle();
  if(h){
   await sb.from("investment_holdings").update({
    units:Number(h.units)+units,
    invested_amount:Number(h.invested_amount)+amount,
    current_value:Number(h.current_value)+amount,
    avg_price:(Number(h.invested_amount)+amount)/(Number(h.units)+units)
   }).eq("id",h.id);
  }else await sb.from("investment_holdings").insert({
   user_id:req.user.id,product_id:productId,units,invested_amount:amount,
   current_value:amount,avg_price:p.unit_price
  });
  res.json({ok:true,units,amount});
 }catch(e){res.status(400).json({error:e.message});}
});

/* REFERRALS / COUPONS */
app.get("/api/referrals",auth,async(req,res)=>{
 const {data,error}=await sb.from("referrals").select("*").eq("referrer_id",req.user.id);
 res.json({data:data||[],error:error?.message});
});
app.post("/api/coupons/check",auth,async(req,res)=>{
 const {data,error}=await sb.from("coupons").select("*").eq("code",clean(req.body.code).toUpperCase()).eq("active",true).maybeSingle();
 res.status(error?400:200).json(data||{valid:false});
});

/* DELIVERY */
app.post("/api/delivery",auth,async(req,res)=>{
 try{
  safeText(req.body.pickup);safeText(req.body.dropoff);
  const {data,error}=await sb.from("delivery_requests").insert({
   user_id:req.user.id,room_id:req.body.room_id,pickup:req.body.pickup,
   dropoff:req.body.dropoff,provider:req.body.provider,status:"AVAILABLE",
   price:req.body.price
  }).select().single();
  if(error)throw error;
  res.json(data);
 }catch(e){res.status(400).json({error:e.message});}
});
app.get("/api/delivery",auth,async(req,res)=>{
 const {data,error}=await sb.from("delivery_requests").select("*").eq("user_id",req.user.id).order("created_at",{ascending:false});
 res.json({data:data||[],error:error?.message});
});

/* ADVERTISING */
app.get("/api/ads",auth,async(req,res)=>{
 const {data,error}=await sb.from("ads").select("*").eq("status","ACTIVE").order("created_at",{ascending:false});
 res.json({data:data||[],error:error?.message});
});
app.post("/api/ads",auth,async(req,res)=>{
 try{
  safeText(req.body.company);safeText(req.body.headline);safeText(req.body.description);
  const {data,error}=await sb.from("ads").insert({
   user_id:req.user.id,company:req.body.company,logo:req.body.logo,
   promotional_image:req.body.promotional_image,headline:req.body.headline,
   description:req.body.description,offer:req.body.offer,cta:req.body.cta,
   link:req.body.link,daily_budget:req.body.daily_budget,duration:req.body.duration,
   target_location:req.body.target_location,target_category:req.body.target_category,
   status:"PENDING",sponsored:true
  }).select().single();
  if(error)throw error;
  res.json(data);
 }catch(e){res.status(400).json({error:e.message});}
});

/* DGBO BUSINESS OPPORTUNITIES */
app.post("/api/dgbo/opportunities",auth,async(req,res)=>{
 try{
  safeText(req.body.title);safeText(req.body.description);
  const {data,error}=await sb.from("business_opportunities").insert({
   owner_id:req.user.id,title:req.body.title,description:req.body.description,
   type:req.body.type,amount:req.body.amount,location:req.body.location,
   category:req.body.category,status:"REVIEW"
  }).select().single();
  if(error)throw error;
  res.json({message:"Submitted to DGBO for review.",data});
 }catch(e){res.status(400).json({error:e.message});}
});
app.get("/api/dgbo/opportunities",auth,async(req,res)=>{
 const {data,error}=await sb.from("business_opportunities").select("*").eq("status","PUBLISHED").order("created_at",{ascending:false});
 res.json({data:data||[],error:error?.message});
});

/* OFFLINE SYNC QUEUE */
app.post("/api/sync",auth,async(req,res)=>{
 const actions=Array.isArray(req.body.actions)?req.body.actions:[];
 const results=[];
 for(const a of actions){
  try{
   if(a.type==="MESSAGE"){
    safeText(a.message);
    await sb.from("messages").insert({room_id:a.room_id,sender_id:req.user.id,message:a.message});
   }else if(a.type==="NOTIFICATION"){
    await sb.from("notifications").insert({user_id:req.user.id,title:a.title,message:a.message});
   }
   results.push({id:a.id,ok:true});
  }catch(e){results.push({id:a.id,ok:false,error:e.message});}
 }
 res.json({synced:results});
});

/* NOTIFICATIONS */
app.get("/api/notifications",auth,async(req,res)=>{
 const {data,error}=await sb.from("notifications").select("*").eq("user_id",req.user.id).order("created_at",{ascending:false}).limit(100);
 res.json({data:data||[],error:error?.message});
});

/* REPORT */
app.post("/api/report",auth,async(req,res)=>{
 const {data,error}=await sb.from("reports").insert({
  user_id:req.user.id,target_type:req.body.target_type,
  target_id:req.body.target_id,reason:req.body.reason,status:"OPEN"
 }).select().single();
 res.status(error?400:200).json(error?{error:error.message}:data);
});

/* OWNER */
app.post("/api/owner/login",(req,res)=>{
 if(clean(req.body.key)!==OWNER)return res.status(401).json({error:"Invalid owner key"});
 res.json({token:jwt.sign({id:"OWNER",role:"owner"},JWT,{expiresIn:"12h"})});
});

app.get("/api/owner/stats",auth,owner,async(req,res)=>{
 const tables=["members","listings","deal_rooms","payments","tasks","delivery_requests","ads","shorts","reports","investment_transactions"];
 const out={};
 for(const t of tables){
  const {count}=await sb.from(t).select("*",{count:"exact",head:true});
  out[t]=count||0;
 }
 res.json(out);
});

app.get("/api/owner/:table",auth,owner,async(req,res)=>{
 const allowed=["members","listings","deal_rooms","payments","tasks","workers","ads","shorts","reports","delivery_requests","investment_products","investment_transactions","investment_holdings","business_opportunities","coupons","platform_settings","audit_logs"];
 if(!allowed.includes(req.params.table))return res.status(400).json({error:"Table not allowed"});
 const {data,error}=await sb.from(req.params.table).select("*").order("created_at",{ascending:false}).limit(500);
 res.json({data:data||[],error:error?.message});
});
app.patch("/api/owner/:table/:id",auth,owner,async(req,res)=>{
 const allowed=["members","listings","tasks","workers","ads","shorts","reports","delivery_requests","investment_products","coupons","business_opportunities","platform_settings"];
 if(!allowed.includes(req.params.table))return res.status(400).json({error:"Table not allowed"});
 const {data,error}=await sb.from(req.params.table).update(req.body).eq("id",req.params.id).select().single();
 if(!error)await log("OWNER","OWNER_EDIT",req.params.table,req.params.id,req.body);
 res.status(error?400:200).json(error?{error:error.message}:data);
});

/* WHATSAPP */
app.post("/api/webhook/whatsapp",async(req,res)=>{
 try{
  const p=phone(req.body.From),text=clean(req.body.Body);
  if(!p)return res.type("text/xml").send(twiml("Welcome to JR PHEEF — Find. Match. Trade."));
  const {data:u}=await sb.from("members").select("*").eq("phone",p).maybeSingle();
  if(!u)return res.type("text/xml").send(twiml("Welcome to JR PHEEF.\nCreate your account at jr-pheef-marketplace.onrender.com"));
  if(contactBlocked(text))return res.type("text/xml").send(twiml("🔐 Contact details are protected. Please use your JR PHEEF Deal Room."));
  const up=text.toUpperCase();
  let reply="JR PHEEF\n\nFind. Match. Trade.\n\nTry: FIND, DEALS, WORK, DELIVERY or HELP.";
  if(up==="HELP")reply="JR PHEEF\n\nFIND — marketplace\nDEALS — your Deal Rooms\nWORK — tasks & talent\nDELIVERY — delivery\nSHORTS — video discovery";
  if(up==="DEALS"){
   const {data}=await sb.from("deal_rooms").select("id,status").or(`buyer_id.eq.${u.id},seller_id.eq.${u.id}`).order("created_at",{ascending:false}).limit(10);
   reply=`📂 DEAL ROOMS\n\n${(data||[]).map((x,i)=>`${i+1}. ${x.status}`).join("\n")||"No Deal Rooms yet."}`;
  }
  if(tw)try{await tw.messages.create({from:process.env.TWILIO_WHATSAPP_NUMBER,to:`whatsapp:${p}`,body:reply});}catch(e){console.error("TWILIO",e.message);}
  res.type("text/xml").send("<Response></Response>");
 }catch(e){console.error(e);res.type("text/xml").send(twiml("JR PHEEF is temporarily unable to process that request."));}
});

/* SPA */
app.get(/.*/,(req,res)=>{
 if(req.path.startsWith("/api/"))return res.status(404).json({error:"API route not found"});
 res.sendFile(path.join(__dirname,"public","index.html"));
});

app.listen(PORT,()=>console.log(`🚀 JR PHEEF LIVE on ${PORT}`));
