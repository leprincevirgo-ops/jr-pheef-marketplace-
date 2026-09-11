const express=require("express"),{createClient}=require("@supabase/supabase-js"),bcrypt=require("bcryptjs"),jwt=require("jsonwebtoken"),rateLimit=require("express-rate-limit");
const app=express(),PORT=process.env.PORT||10000;
const URL=process.env.SUPABASE_URL,KEY=process.env.SUPABASE_KEY||process.env.SUPABASE_SERVICE_ROLE_KEY,ANON=process.env.SUPABASE_ANON_KEY;
const JWT=process.env.JWT_SECRET||"change-this",OWNER=process.env.OWNER_KEY||"";
const db=createClient(URL,KEY),authdb=createClient(URL,ANON||KEY);
app.use(express.json({limit:"15mb"}));app.use(express.urlencoded({extended:true}));app.use(rateLimit({windowMs:60000,max:150}));
app.use(express.static("public"));

const ok=(res,data)=>res.json({ok:true,...data}),fail=(res,e)=>res.status(400).json({error:e.message||String(e)});
const token=u=>jwt.sign({id:u.id,role:u.role||"user"},JWT,{expiresIn:"30d"});
const shield=x=>/(?:\+?\d[\d\s().-]{7,}|(?:whatsapp|telegram|signal|call|text|email|gmail|@)|07\d{8}|01\d{8})/i.test(String(x||""));
async function user(id){let{data,error}=await db.from("members").select("*").eq("id",id).single();if(error)throw error;return data}
async function auth(req,res,next){try{let h=req.headers.authorization||"";if(!h.startsWith("Bearer "))throw Error("Login required");let x=jwt.verify(h.slice(7),JWT);req.user=x.role==="owner"?{id:"OWNER",role:"owner",name:"ROBERT"}:await user(x.id);next()}catch(e){res.status(401).json({error:"Login required"})}}
function owner(req,res,next){if(req.user?.role!=="owner")return res.status(403).json({error:"Owner only"});next()}
async function rows(table,q={}){let x=db.from(table).select("*");for(let k in q)x=x.eq(k,q[k]);let{data,error}=await x.order("created_at",{ascending:false});if(error)throw error;return data||[]}
async function upload(path,data,type){let b=Buffer.from(data.split(",")[1],"base64");let{error}=await db.storage.from("jr-pheef").upload(path,b,{contentType:type||"application/octet-stream",upsert:true});if(error)throw error;return db.storage.from("jr-pheef").getPublicUrl(path).data.publicUrl}

app.get("/api/health",(q,r)=>ok(r,{service:"JR PHEEF",status:"online"}));

/* AUTH */
app.post("/api/auth/signup",async(req,res)=>{try{
 let{name,email,password,phone,birth_year,referral_code,terms_agreed}=req.body;
 if(!name||!email||!password||!phone||!birth_year||!terms_agreed)throw Error("Complete all required fields.");
 if(!/^\S+@\S+\.\S+$/.test(email))throw Error("Enter a valid email.");
 let{data:exists}=await db.from("members").select("id").or(`email.eq.${email},phone.eq.${phone}`).maybeSingle();
 if(exists)throw Error("Email or phone already registered.");
 let{data:ref}=referral_code?await db.from("members").select("id").eq("referral_code",referral_code).maybeSingle():{data:null};
 let u={name,email:email.toLowerCase(),phone,birth_year,password_hash:await bcrypt.hash(password,10),role:"user",membership:"FREE+",credits:0,cash_balance:0,rewards:0,referral_code:"JP"+Math.random().toString(36).slice(2,9).toUpperCase(),referred_by:ref?.id||null,terms_agreed_at:new Date().toISOString()};
 let{data,error}=await db.from("members").insert(u).select("*").single();if(error)throw error;
 if(ref)await db.from("referrals").insert({referrer_id:ref.id,referred_id:u.id,reward:0,status:"PENDING"});
 ok(res,{token:token(data),user:data});
}catch(e){fail(res,e)}});

app.post("/api/auth/login",async(req,res)=>{try{
 let{email,password}=req.body,{data:u,error}=await db.from("members").select("*").eq("email",String(email).toLowerCase()).single();
 if(error||!u||!(await bcrypt.compare(password,u.password_hash)))throw Error("Invalid email or password.");
 await db.from("members").update({last_active_at:new Date().toISOString()}).eq("id",u.id);
 ok(res,{token:token(u),user:u});
}catch(e){fail(res,e)}});

app.get("/api/auth/google",async(req,res)=>{try{
 let{data,error}=await authdb.auth.signInWithOAuth({provider:"google",options:{redirectTo:(process.env.APP_URL||"https://jr-pheef-marketplace.onrender.com")+"/api/auth/google/callback"}});
 if(error)throw error;ok(res,{url:data.url});
}catch(e){fail(res,e)}});

app.get("/api/auth/google/callback",async(req,res)=>{try{
 let{data,error}=await authdb.auth.exchangeCodeForSession(req.query.code);if(error)throw error;
 let g=data.user,email=g.email;if(!email)throw Error("Google account has no email.");
 let{data:u}=await db.from("members").select("*").eq("email",email.toLowerCase()).maybeSingle();
 if(!u){let{data:n,error:e}=await db.from("members").insert({name:g.user_metadata?.full_name||email.split("@")[0],email:email.toLowerCase(),role:"user",membership:"FREE+",google_verified:true,credits:0,cash_balance:0,rewards:0,referral_code:"JP"+Math.random().toString(36).slice(2,9).toUpperCase(),terms_agreed_at:new Date().toISOString()}).select("*").single();if(e)throw e;u=n}
 res.redirect("/?token="+token(u));
}catch(e){res.redirect("/?error="+encodeURIComponent(e.message))}});

app.get("/api/me",auth,async(req,res)=>ok(res,{user:req.user}));

/* STORAGE */
app.post("/api/upload",auth,async(req,res)=>{try{
 let{data,name,type,folder="uploads"}=req.body;if(!data)throw Error("File missing.");
 if(data.length>12000000)throw Error("File too large.");
 let url=await upload(`${folder}/${req.user.id}/${Date.now()}-${String(name||"file").replace(/\W+/g,"_")}`,data,type);
 ok(res,{url});
}catch(e){fail(res,e)}});

/* MARKET */
app.get("/api/listings",auth,async(req,res)=>{try{
 let{data,error}=await db.from("listings").select("*").eq("status","ACTIVE").order("created_at",{ascending:false});
 if(error)throw error;let q=String(req.query.q||"").toLowerCase();
 if(q)data=(data||[]).filter(x=>`${x.title} ${x.description} ${x.category} ${x.location} ${x.country}`.toLowerCase().includes(q));
 ok(res,{data});
}catch(e){fail(res,e)}});

app.post("/api/listings",auth,async(req,res)=>{try{
 let{x}=req.body; x=x||req.body;let{title,description,price,location,country,category,images=[]}=x;
 if(!title||Number(price)<=100)throw Error("Listing price must be above KSh 100.");
 if(!Array.isArray(images)||images.length<3||images.length>20)throw Error("Upload 3 to 20 photos.");
 if(shield(title)||shield(description))throw Error("Contact information is not allowed.");
 let{data,error}=await db.from("listings").insert({user_id:req.user.id,title,description,price,location,country,category,images,status:"ACTIVE"}).select("*").single();
 if(error)throw error;ok(res,{data});
}catch(e){fail(res,e)}});

/* DEAL ROOMS */
app.post("/api/deals",auth,async(req,res)=>{try{
 let{seller_id,listing_id,task_id}=req.body;if(seller_id===req.user.id)throw Error("You cannot match yourself.");
 let{data:d,error}=await db.from("deal_rooms").insert({buyer_id:req.user.id,seller_id,listing_id,task_id,status:"OPEN"}).select("*").single();if(error)throw error;
 ok(res,{data:d});
}catch(e){fail(res,e)}});

app.get("/api/deals",auth,async(req,res)=>{try{
 let{data,error}=await db.from("deal_rooms").select("*").or(`buyer_id.eq.${req.user.id},seller_id.eq.${req.user.id}`).order("created_at",{ascending:false});if(error)throw error;ok(res,{data});
}catch(e){fail(res,e)}});

app.get("/api/deals/:id/messages",auth,async(req,res)=>{try{
 let{data:r}=await db.from("deal_rooms").select("*").eq("id",req.params.id).single();if(!r||![r.buyer_id,r.seller_id].includes(req.user.id))throw Error("Access denied.");
 ok(res,{data:await rows("messages",{room_id:req.params.id})});
}catch(e){fail(res,e)}});

app.post("/api/deals/:id/messages",auth,async(req,res)=>{try{
 let{message}=req.body;if(!message||shield(message))throw Error("Contact information cannot be shared here.");
 let{data:r}=await db.from("deal_rooms").select("*").eq("id",req.params.id).single();if(!r||![r.buyer_id,r.seller_id].includes(req.user.id))throw Error("Access denied.");
 let{data:m,error}=await db.from("messages").insert({room_id:r.id,sender_id:req.user.id,message}).select("*").single();if(error)throw error;ok(res,{data:m});
}catch(e){fail(res,e)}});

/* WORK */
app.post("/api/tasks",auth,async(req,res)=>{try{
 let{title,description,budget,location,skill,urgency="NORMAL"}=req.body;
 if(shield(title)||shield(description))throw Error("Contact information is not allowed.");
 let{data,error}=await db.from("tasks").insert({owner_id:req.user.id,title,description,budget,location,skill,urgency,status:"MATCHING"}).select("*").single();if(error)throw error;ok(res,{data});
}catch(e){fail(res,e)}});

app.get("/api/tasks",auth,async(req,res)=>{try{ok(res,{data:await rows("tasks")})}catch(e){fail(res,e)}});

app.post("/api/talent",auth,async(req,res)=>{try{
 let{skills,location,experience,availability="AVAILABLE"}=req.body;
 let{data,error}=await db.from("workers").upsert({user_id:req.user.id,skills,location,experience,availability},{onConflict:"user_id"}).select("*").single();if(error)throw error;ok(res,{data});
}catch(e){fail(res,e)}});

app.get("/api/talent",auth,async(req,res)=>{try{ok(res,{data:await rows("workers")})}catch(e){fail(res,e)}});

/* WALLET */
app.get("/api/wallet",auth,async(req,res)=>{try{
 let u=await user(req.user.id),{data:tx}=await db.from("wallet_transactions").select("*").eq("user_id",u.id).order("created_at",{ascending:false}).limit(30);
 ok(res,{cash:Number(u.cash_balance||0),credits:Number(u.credits||0),transactions:tx||[]});
}catch(e){fail(res,e)}});

app.post("/api/withdraw",auth,async(req,res)=>{try{
 let{amount,phone}=req.body;amount=Number(amount);if(amount<200)throw Error("Minimum withdrawal is KSh 200.");
 let u=await user(req.user.id),{data:p}=await db.from("withdrawals").select("amount").eq("user_id",u.id).eq("status","PENDING");let pending=(p||[]).reduce((a,x)=>a+Number(x.amount),0);
 if(Number(u.cash_balance)-pending<amount)throw Error("Insufficient withdrawable balance.");
 let{data,error}=await db.from("withdrawals").insert({user_id:u.id,amount,phone,status:"PENDING"}).select("*").single();if(error)throw error;ok(res,{data});
}catch(e){fail(res,e)}});

/* DELIVERY */
app.post("/api/delivery",auth,async(req,res)=>{try{
 let{pickup,dropoff,provider="JR PHEEF NETWORK",price=0}=req.body;if(shield(pickup)||shield(dropoff))throw Error("Contact information is not allowed.");
 let{data,error}=await db.from("delivery_requests").insert({user_id:req.user.id,pickup,dropoff,provider,price,status:"AVAILABLE"}).select("*").single();if(error)throw error;ok(res,{data});
}catch(e){fail(res,e)}});

app.get("/api/delivery",auth,async(req,res)=>{try{ok(res,{data:await rows("delivery_requests",{user_id:req.user.id})})}catch(e){fail(res,e)}});

/* SHORTS */
app.post("/api/shorts",auth,async(req,res)=>{try{
 let{video_url,caption,category}=req.body;if(!video_url)throw Error("Video required.");
 if(shield(caption)||shield(video_url))throw Error("Contact information is not allowed.");
 let{data,error}=await db.from("shorts").insert({user_id:req.user.id,video_url,caption,category,status:"REVIEW"}).select("*").single();if(error)throw error;ok(res,{data});
}catch(e){fail(res,e)}});

app.get("/api/shorts",auth,async(req,res)=>{try{
 let{data,error}=await db.from("shorts").select("*").eq("status","APPROVED").order("created_at",{ascending:false}).limit(50);if(error)throw error;ok(res,{data});
}catch(e){fail(res,e)}});

/* ADS */
app.get("/api/ads",auth,async(req,res)=>{try{ok(res,{data:await rows("ads",{status:"APPROVED"})})}catch(e){fail(res,e)}});

app.post("/api/ads",auth,async(req,res)=>{try{
 let b=req.body;if(shield(`${b.company} ${b.headline} ${b.description} ${b.offer}`))throw Error("Contact information is not allowed.");
 let{data,error}=await db.from("ads").insert({...b,user_id:req.user.id,status:"PENDING"}).select("*").single();if(error)throw error;ok(res,{data});
}catch(e){fail(res,e)}});

/* DGBO */
app.post("/api/dgbo/opportunities",auth,async(req,res)=>{try{
 let b=req.body;if(shield(`${b.title} ${b.description}`))throw Error("Contact information is not allowed.");
 let{data,error}=await db.from("dgbo_opportunities").insert({...b,user_id:req.user.id,status:"REVIEW"}).select("*").single();if(error)throw error;ok(res,{data});
}catch(e){fail(res,e)}});

/* INVEST */
app.get("/api/invest",auth,async(req,res)=>{try{
 let{data:products}=await db.from("investment_products").select("*").order("created_at");
 let{data:holdings}=await db.from("investment_holdings").select("*").eq("user_id",req.user.id);
 let u=await user(req.user.id);ok(res,{growth_credits:Number(u.credits||0),products:products||[],holdings:holdings||[]});
}catch(e){fail(res,e)}});

app.post("/api/invest/buy",auth,async(req,res)=>{try{
 let{product_id,amount}=req.body;amount=Number(amount);if(amount<=0)throw Error("Invalid amount.");
 let{data,error}=await db.rpc("buy_growth_units",{p_user:req.user.id,p_product:product_id,p_amount:amount});if(error)throw error;ok(res,{data});
}catch(e){fail(res,e)}});

/* REFERRALS / COUPONS */
app.get("/api/rewards",auth,async(req,res)=>{try{ok(res,{referrals:await rows("referrals",{referrer_id:req.user.id}),coupons:await rows("coupons",{active:true})})}catch(e){fail(res,e)}});

/* OWNER */
app.post("/api/owner/login",async(req,res)=>{if(!OWNER||req.body.key!==OWNER)return res.status(401).json({error:"Invalid owner key"});ok(res,{token:jwt.sign({id:"OWNER",role:"owner"},JWT,{expiresIn:"12h"})})});
app.get("/api/owner/stats",auth,owner,async(req,res)=>{try{
 let tables=["members","listings","deal_rooms","payments","tasks","delivery_requests","shorts","ads","dgbo_opportunities"];
 let out={};for(let t of tables){let{count}=await db.from(t).select("*",{count:"exact",head:true});out[t]=count||0}ok(res,{stats:out});
}catch(e){fail(res,e)}});

app.get("/api/owner/:table",auth,owner,async(req,res)=>{try{
 const allowed=["members","listings","deal_rooms","payments","tasks","delivery_requests","shorts","ads","dgbo_opportunities","investment_products","investment_holdings","reports","audit_logs"];
 if(!allowed.includes(req.params.table))throw Error("Table unavailable.");
 ok(res,{data:await rows(req.params.table)});
}catch(e){fail(res,e)}});

app.use((req,res)=>{if(req.method==="GET")res.sendFile(require("path").join(process.cwd(),"public","index.html"));else res.status(404).json({error:"Not found"})});
app.listen(PORT,()=>console.log("JR PHEEF running on "+PORT)); 
