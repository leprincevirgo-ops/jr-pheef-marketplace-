const express=require("express");
const path=require("path");
const bcrypt=require("bcryptjs");
const jwt=require("jsonwebtoken");
const rateLimit=require("express-rate-limit");
const {createClient}=require("@supabase/supabase-js");
const twilio=require("twilio");

const app=express();
app.use(express.json({limit:"5mb"}));
app.use(express.urlencoded({extended:true}));
app.use(express.static(path.join(__dirname,"public")));

const PORT=process.env.PORT||10000;
const SUPABASE_URL=process.env.SUPABASE_URL;
const SUPABASE_KEY=process.env.SUPABASE_KEY;
const JWT_SECRET=process.env.JWT_SECRET;

if(!SUPABASE_URL||!SUPABASE_KEY||!JWT_SECRET){
  console.error("Missing SUPABASE_URL, SUPABASE_KEY or JWT_SECRET");
  process.exit(1);
}

const db=createClient(SUPABASE_URL,SUPABASE_KEY);
const limiter=rateLimit({
  windowMs:15*60*1000,
  max:100,
  standardHeaders:true
});
app.use("/api/",limiter);

const id=()=>Date.now().toString(36)+Math.random().toString(36).slice(2,8);
const phone=p=>String(p||"").replace(/[^\d+]/g,"");
const jwtToken=u=>jwt.sign({id:u.id},JWT_SECRET,{expiresIn:"7d"});

const plans={
  free:{price:0,match:30},
  pro:{price:99,match:20},
  prime:{price:149,match:15},
  elite:{price:null,match:null}
};

const skills=[
  "plumbing","electrical","construction","painting","carpentry",
  "welding","cleaning","driving","moving","delivery","technology",
  "software","it","graphic design","photography","video",
  "marketing","sales","accounting","consulting","repair","installation"
];

const skillMatch=t=>{
  t=String(t||"").toLowerCase();
  return skills.find(s=>t.includes(s))||"general";
};

const hasPhone=t=>/(?:\+?254|0)?7\d{8}/.test(String(t||""));

async function user(uid){
  const {data,error}=await db.from("members").select("*").eq("id",uid).maybeSingle();
  if(error) throw error;
  return data;
}

async function auth(req,res,next){
  try{
    const h=req.headers.authorization||"";
    if(!h.startsWith("Bearer ")) return res.status(401).json({error:"Login required"});
    const x=jwt.verify(h.slice(7),JWT_SECRET);
    const u=await user(x.id);
    if(!u)return res.status(401).json({error:"Account not found"});
    req.user=u;
    next();
  }catch(e){
    res.status(401).json({error:"Session expired"});
  }
}

app.get("/health",(req,res)=>res.json({
  ok:true,
  service:"JR PHEEF",
  tagline:"Find. Match. Trade."
}));

/* SIGN UP */
app.post("/api/signup",async(req,res)=>{
  try{
    const {name,phone:rawPhone,password,birth_year,referral_code,terms_agreed}=req.body;
    const p=phone(rawPhone);

    if(!name||!p||!password)
      return res.status(400).json({error:"Name, phone and password are required"});

    if(!terms_agreed)
      return res.status(400).json({error:"You must agree to JR PHEEF Terms & Conditions"});

    if(password.length<6)
      return res.status(400).json({error:"Password must be at least 6 characters"});

    const {data:existing}=await db.from("members")
      .select("id").eq("phone",p).maybeSingle();

    if(existing)
      return res.status(409).json({error:"Account already exists"});

    let referredBy=null;

    if(referral_code){
      const {data:r}=await db.from("members")
        .select("id").eq("referral_code",referral_code).maybeSingle();
      if(r)referredBy=r.id;
    }

    const u={
      id:id(),
      name:String(name).trim(),
      phone:p,
      password_hash:await bcrypt.hash(password,10),
      birth_year:birth_year?Number(birth_year):null,
      membership:"free",
      credits:0,
      rewards:0,
      referral_code:"JRP-"+Math.random().toString(36).slice(2,7).toUpperCase(),
      referred_by:referredBy,
      terms_agreed_at:new Date().toISOString()
    };

    const {error}=await db.from("members").insert(u);
    if(error)throw error;

    if(referredBy){
      const r=await user(referredBy);
      if(r){
        await db.from("members").update({
          rewards:Number(r.rewards||0)+50
        }).eq("id",referredBy);
      }
    }

    res.json({
      ok:true,
      message:"Welcome to JR PHEEF",
      token:jwtToken(u),
      user:{
        id:u.id,
        name:u.name,
        phone:u.phone,
        membership:u.membership,
        referral_code:u.referral_code
      }
    });

  }catch(e){
    console.error(e);
    res.status(500).json({error:"Signup failed"});
  }
});

/* LOGIN */
app.post("/api/login",async(req,res)=>{
  try{
    const p=phone(req.body.phone);
    const {data:u}=await db.from("members")
      .select("*").eq("phone",p).maybeSingle();

    if(!u||!(await bcrypt.compare(req.body.password||"",u.password_hash)))
      return res.status(401).json({error:"Invalid phone or password"});

    res.json({
      ok:true,
      token:jwtToken(u),
      user:{
        id:u.id,
        name:u.name,
        phone:u.phone,
        membership:u.membership,
        credits:u.credits,
        rewards:u.rewards,
        referral_code:u.referral_code
      }
    });

  }catch(e){
    res.status(500).json({error:"Login failed"});
  }
});

/* CURRENT USER */
app.get("/api/me",auth,async(req,res)=>{
  const u=req.user;
  res.json({
    id:u.id,
    name:u.name,
    phone:u.phone,
    membership:u.membership,
    credits:u.credits,
    rewards:u.rewards,
    referral_code:u.referral_code,
    terms_agreed_at:u.terms_agreed_at
  });
});

/* MARKETPLACE */
app.get("/api/listings",async(req,res)=>{
  try{
    let q=db.from("listings")
      .select("*")
      .eq("status","active")
      .order("created_at",{ascending:false})
      .limit(100);

    if(req.query.category)q=q.eq("category",req.query.category);
    if(req.query.location)q=q.ilike("location",`%${req.query.location}%`);

    const {data,error}=await q;
    if(error)throw error;

    res.json({ok:true,listings:data||[]});
  }catch(e){
    res.status(500).json({error:"Could not load marketplace"});
  }
});

/* CREATE LISTING */
app.post("/api/listings",auth,async(req,res)=>{
  try{
    const {
      title,description,price,location,category,images=[]
    }=req.body;

    const amount=Number(price);

    if(!title||!amount||amount<=100)
      return res.status(400).json({
        error:"Items must be priced above KSh 100"
      });

    if(!Array.isArray(images)||images.length<3)
      return res.status(400).json({
        error:"Please upload at least 3 photos"
      });

    if(images.length>20)
      return res.status(400).json({
        error:"Maximum 20 photos"
      });

    const listing={
      id:id(),
      user_id:req.user.id,
      title:String(title).trim(),
      description:String(description||"").trim(),
      price:amount,
      location:String(location||"").trim(),
      category:String(category||"general").trim(),
      images,
      status:"active"
    };

    const {error}=await db.from("listings").insert(listing);
    if(error)throw error;

    res.json({ok:true,listing});
  }catch(e){
    console.error(e);
    res.status(500).json({error:"Listing failed"});
  }
});

/* POST WORK */
app.post("/api/work",auth,async(req,res)=>{
  try{
    const {
      title,description,location,budget,urgency
    }=req.body;

    if(!title||!description)
      return res.status(400).json({
        error:"Title and description required"
      });

    const skill=skillMatch(title+" "+description);

    const {data:workers}=await db.from("workers")
      .select("*")
      .eq("status","available");

    const match=(workers||[]).find(w=>
      String(w.skills||"").toLowerCase().includes(skill)
    );

    const task={
      id:id(),
      owner_id:req.user.id,
      worker_id:match?.id||null,
      title,
      description,
      location:location||"",
      budget:Number(budget||0),
      urgency:urgency||"normal",
      skill,
      status:match?"ROUTED":"MATCHING"
    };

    const {error}=await db.from("tasks").insert(task);
    if(error)throw error;

    res.json({
      ok:true,
      task,
      message:match?
        `JR PHEEF matched your task to a ${skill} worker.`:
        "JR PHEEF is searching for a suitable person."
    });

  }catch(e){
    console.error(e);
    res.status(500).json({error:"Work request failed"});
  }
});

/* WORKER PROFILE */
app.post("/api/workers",auth,async(req,res)=>{
  try{
    const {skills:workerSkills,location,experience}=req.body;

    if(!workerSkills)
      return res.status(400).json({error:"Skills required"});

    const worker={
      id:id(),
      user_id:req.user.id,
      skills:String(workerSkills),
      location:location||"",
      experience:experience||"",
      status:"available",
      rating:0,
      jobs:0
    };

    const {error}=await db.from("workers").insert(worker);
    if(error)throw error;

    res.json({ok:true,worker});
  }catch(e){
    res.status(500).json({error:"Worker registration failed"});
  }
});

/* WORK STATUS */
app.post("/api/work/:id/status",auth,async(req,res)=>{
  const allowed=[
    "MATCHING","ROUTED","ACCEPTED","IN PROGRESS",
    "SUBMITTED FOR VERIFICATION","VERIFIED","PAYMENT",
    "COMPLETED","CANCELLED","DISPUTED","REASSIGNED"
  ];

  if(!allowed.includes(req.body.status))
    return res.status(400).json({error:"Invalid status"});

  const {data,error}=await db.from("tasks")
    .update({status:req.body.status})
    .eq("id",req.params.id)
    .eq("owner_id",req.user.id)
    .select().single();

  if(error)return res.status(400).json({error:"Task update failed"});
  res.json({ok:true,task:data});
});

/* DEAL ROOM */
app.post("/api/dealrooms",auth,async(req,res)=>{
  try{
    const {
      seller_id,
      buyer_id,
      listing_id,
      task_id
    }=req.body;

    const buyer=buyer_id||req.user.id;
    const seller=seller_id;

    if(!seller||seller===buyer)
      return res.status(400).json({error:"Valid buyer and seller required"});

    const {data:room,error}=await db.from("deal_rooms")
      .insert({
        id:id(),
        buyer_id:buyer,
        seller_id:seller,
        listing_id:listing_id||null,
        task_id:task_id||null,
        status:"OPEN"
      })
      .select().single();

    if(error)throw error;

    res.json({ok:true,room});
  }catch(e){
    console.error(e);
    res.status(500).json({error:"Deal Room creation failed"});
  }
});

app.get("/api/dealrooms",auth,async(req,res)=>{
  const {data,error}=await db.from("deal_rooms")
    .select("*")
    .or(`buyer_id.eq.${req.user.id},seller_id.eq.${req.user.id}`)
    .order("created_at",{ascending:false});

  if(error)return res.status(500).json({error:"Could not load Deal Rooms"});
  res.json({ok:true,rooms:data||[]});
});

/* CHAT */
app.get("/api/dealrooms/:id/messages",auth,async(req,res)=>{
  const {data:room}=await db.from("deal_rooms")
    .select("*").eq("id",req.params.id).maybeSingle();

  if(!room||
    room.buyer_id!==req.user.id&&
    room.seller_id!==req.user.id)
    return res.status(403).json({error:"Access denied"});

  const {data,error}=await db.from("messages")
    .select("*")
    .eq("room_id",req.params.id)
    .order("created_at",{ascending:true});

  if(error)return res.status(500).json({error:"Chat unavailable"});
  res.json({ok:true,messages:data||[]});
});

app.post("/api/dealrooms/:id/messages",auth,async(req,res)=>{
  try{
    const text=String(req.body.message||"").trim();

    if(!text)return res.status(400).json({error:"Message required"});

    const {data:room}=await db.from("deal_rooms")
      .select("*").eq("id",req.params.id).maybeSingle();

    if(!room||
      room.buyer_id!==req.user.id&&
      room.seller_id!==req.user.id)
      return res.status(403).json({error:"Access denied"});

    if(hasPhone(text))
      return res.status(400).json({
        error:"For safety, phone numbers cannot be shared in chat before connection is completed."
      });

    const {data,error}=await db.from("messages")
      .insert({
        id:id(),
        room_id:room.id,
        sender_id:req.user.id,
        message:text
      })
      .select().single();

    if(error)throw error;

    res.json({ok:true,message:data});
  }catch(e){
    res.status(500).json({error:"Message failed"});
  }
});

/* PAYMENT REQUEST */
app.post("/api/payments",auth,async(req,res)=>{
  try{
    const {room_id,amount,purpose="connection"}=req.body;
    const value=Number(amount);

    if(!room_id||!value||value<=0)
      return res.status(400).json({error:"Valid payment required"});

    const {data:room}=await db.from("deal_rooms")
      .select("*").eq("id",room_id).maybeSingle();

    if(!room||
      room.buyer_id!==req.user.id&&
      room.seller_id!==req.user.id)
      return res.status(403).json({error:"Access denied"});

    const {data:payment,error}=await db.from("payments")
      .insert({
        id:id(),
        user_id:req.user.id,
        room_id,
        amount:value,
        purpose,
        status:"PENDING"
      })
      .select().single();

    if(error)throw error;

    res.json({
      ok:true,
      payment,
      message:"Payment created. Confirmation must come from the connected payment provider."
    });

  }catch(e){
    console.error(e);
    res.status(500).json({error:"Payment request failed"});
  }
});

/* REAL PAYMENT CALLBACK */
app.post("/api/payments/callback",async(req,res)=>{
  try{
    const secret=req.headers["x-payment-secret"];

    if(!process.env.PAYMENT_CALLBACK_SECRET||
      secret!==process.env.PAYMENT_CALLBACK_SECRET)
      return res.status(401).json({error:"Unauthorized"});

    const {
      payment_id,status,provider_reference
    }=req.body;

    if(!payment_id||!["PAID","FAILED","CANCELLED"].includes(status))
      return res.status(400).json({error:"Invalid payment callback"});

    const update={
      status,
      provider_reference:provider_reference||null
    };

    if(status==="PAID")
      update.confirmed_at=new Date().toISOString();

    const {data,error}=await db.from("payments")
      .update(update)
      .eq("id",payment_id)
      .select().single();

    if(error)throw error;

    res.json({ok:true,payment:data});
  }catch(e){
    console.error(e);
    res.status(500).json({error:"Payment callback failed"});
  }
});

/* REFERRALS */
app.post("/api/referrals",auth,async(req,res)=>{
  try{
    const code=req.user.referral_code;

    const {count,error}=await db.from("members")
      .select("*",{count:"exact",head:true})
      .eq("referred_by",req.user.id);

    if(error)throw error;

    res.json({
      ok:true,
      referral_code:code,
      referrals:count||0,
      rewards:req.user.rewards||0,
      minimum_withdrawal:200
    });
  }catch(e){
    res.status(500).json({error:"Referral information unavailable"});
  }
});

/* COUPONS */
app.post("/api/coupons/check",auth,async(req,res)=>{
  try{
    const code=String(req.body.code||"").trim().toUpperCase();

    if(!code)return res.status(400).json({error:"Coupon code required"});

    const {data,error}=await db.from("coupons")
      .select("*")
      .eq("code",code)
      .eq("active",true)
      .maybeSingle();

    if(error)throw error;

    if(!data)return res.status(404).json({error:"Invalid coupon"});

    if(data.expires_at&&new Date(data.expires_at)<new Date())
      return res.status(400).json({error:"Coupon expired"});

    res.json({
      ok:true,
      coupon:data
    });

  }catch(e){
    res.status(500).json({error:"Coupon check failed"});
  }
});

/* WHATSAPP */
app.post("/api/webhook/whatsapp",async(req,res)=>{
  try{
    const incoming=String(req.body.Body||"").trim();
    const from=phone(req.body.From||"");

    let reply;

    if(!incoming){
      reply="Karibu JR PHEEF 👋\nFind. Match. Trade.\n\nBUY — find something\nSELL — sell something\nWORK — find/post work";
    }else{
      const text=incoming.toLowerCase();

      if(text.includes("buy"))
        reply="JR PHEEF is ready to help you BUY. Tell me what you are looking for and your location.";
      else if(text.includes("sell"))
        reply="Ready to SELL? Send the item name, price, location and at least 3 photos.";
      else if(text.includes("work"))
        reply="Tell JR PHEEF the work you need done, your location and budget. We will match you with a suitable person.";
      else
        reply="Nimekupata 👍 Tell me what you want to BUY, SELL or WORK on, and JR PHEEF will guide you.";
    }

    const twiml=new twilio.twiml.MessagingResponse();
    twiml.message(reply);

    res.type("text/xml").send(twiml.toString());

  }catch(e){
    console.error(e);
    res.status(500).send("Webhook error");
  }
});

/* FRONTEND */
app.use((req,res)=>{
  if(req.method==="GET")
    return res.sendFile(path.join(__dirname,"public","index.html"));

  res.status(404).json({error:"Route not found"});
});

app.listen(PORT,()=>{
  console.log(`JR PHEEF running on port ${PORT}`);
});
