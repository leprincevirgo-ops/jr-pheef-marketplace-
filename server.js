const express = require("express");
const { createClient } = require("@supabase/supabase-js");
const twilio = require("twilio");

const app = express();
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

const PORT = process.env.PORT || 10000;
const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_KEY
);

const plans = {
  free: { price: 0, match: 30 },
  pro: { price: 99, match: 20 },
  prime: { price: 149, match: 20 }
};

const skills = [
  "plumbing","electrical","construction","painting","carpentry",
  "welding","cleaning","driving","moving","delivery","technology",
  "software","it","graphic design","photography","video",
  "marketing","sales","accounting","consulting","repair","installation"
];

const uid = () =>
  Date.now().toString(36) + Math.random().toString(36).slice(2,7);

const phone = p => String(p || "").replace(/[^\d+]/g,"");

const skillOf = text => {
  text = String(text || "").toLowerCase();
  return skills.find(s => text.includes(s)) || "other";
};

/* HOME */

app.get("/", (req,res) => {
  res.send(`
<!DOCTYPE html>
<html>
<head>
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>JR PHEEF</title>
<style>
body{font-family:Arial;background:#08101f;color:white;padding:25px}
.card{background:#151e32;padding:20px;margin:12px 0;border-radius:15px}
h1{font-size:42px}
button{padding:12px 18px;border:0;border-radius:8px}
</style>
</head>
<body>
<h1>JR PHEEF</h1>
<p>Find. Match. Trade.</p>

<div class="card">
<h2>MARKET</h2>
<p>Buy and sell products and services.</p>
</div>

<div class="card">
<h2>WORK</h2>
<p>Post a task. JR PHEEF finds the right skilled person, team or company.</p>
</div>

<div class="card">
<h2>DEAL ROOMS</h2>
<p>CHAT • FILES • PAYMENT • ACTIVITY</p>
</div>

<div class="card">
<h2>JR PHEEF PAY</h2>
<p>Payments • Rewards • Referrals • Coupons</p>
</div>

<p>Powered by JR PHEEF</p>
</body>
</html>
`);
});

/* HEALTH */

app.get("/health",(req,res)=>{
  res.json({
    ok:true,
    service:"JR PHEEF",
    status:"online",
    time:new Date().toISOString()
  });
});

/* SIGN UP */

app.post("/api/signup",async(req,res)=>{
  const {name,phone:rawPhone,password,birth_year,role="user"}=req.body;

  if(!name||!rawPhone||!password)
    return res.status(400).json({error:"Name, phone and password required"});

  const user={
    id:uid(),
    name,
    phone:phone(rawPhone),
    password,
    birth_year:birth_year||null,
    role,
    membership:"free",
    credits:0,
    rewards:0,
    referral_code:"JRP-"+uid().slice(-5).toUpperCase(),
    created_at:new Date().toISOString()
  };

  const {data,error}=await supabase
    .from("members")
    .insert(user)
    .select()
    .single();

  if(error)
    return res.status(400).json({error:error.message});

  res.json({ok:true,user:data});
});

/* LOGIN */

app.post("/api/login",async(req,res)=>{
  const {phone:rawPhone,password}=req.body;

  const {data,error}=await supabase
    .from("members")
    .select("*")
    .eq("phone",phone(rawPhone))
    .eq("password",password)
    .single();

  if(error)
    return res.status(401).json({error:"Invalid login"});

  res.json({ok:true,user:data});
});

/* LIST ITEM */

app.post("/api/listings",async(req,res)=>{
  const {
    user_id,title,description,price,location,category,
    images=[]
  }=req.body;

  if(!user_id||!title||!price)
    return res.status(400).json({error:"Listing details required"});

  if(Number(price)<=100)
    return res.status(400).json({error:"Minimum price is above KSh 100"});

  if(images.length<3)
    return res.status(400).json({error:"Add at least 3 photos"});

  if(images.length>20)
    return res.status(400).json({error:"Maximum 20 photos"});

  const {data,error}=await supabase
    .from("listings")
    .insert({
      id:uid(),
      user_id,
      title,
      description,
      price,
      location,
      category,
      images,
      status:"active",
      created_at:new Date().toISOString()
    })
    .select()
    .single();

  if(error)
    return res.status(400).json({error:error.message});

  res.json({ok:true,listing:data});
});

/* FIND */

app.get("/api/listings",async(req,res)=>{
  const {q,category,location}=req.query;

  let query=supabase
    .from("listings")
    .select("*")
    .eq("status","active")
    .order("created_at",{ascending:false});

  if(category) query=query.ilike("category",`%${category}%`);
  if(location) query=query.ilike("location",`%${location}%`);
  if(q) query=query.or(
    `title.ilike.%${q}%,description.ilike.%${q}%`
  );

  const {data,error}=await query.limit(50);

  if(error)
    return res.status(400).json({error:error.message});

  res.json(data);
});

/* WORK / TASKBRIDGE */

app.post("/api/work",async(req,res)=>{
  const {
    owner_id,title,description,location,budget,
    urgency="normal",company_id=null
  }=req.body;

  if(!owner_id||!title||!description)
    return res.status(400).json({error:"Task details required"});

  const skill=skillOf(title+" "+description);

  const task={
    id:uid(),
    owner_id,
    company_id,
    title,
    description,
    location,
    budget:budget||0,
    urgency,
    skill,
    status:"ANALYZING",
    created_at:new Date().toISOString()
  };

  const {data,error}=await supabase
    .from("tasks")
    .insert(task)
    .select()
    .single();

  if(error)
    return res.status(400).json({error:error.message});

  const workers=await supabase
    .from("workers")
    .select("*")
    .eq("status","available")
    .ilike("skills",`%${skill}%`)
    .limit(20);

  await supabase
    .from("tasks")
    .update({
      status:workers.data?.length?"ROUTED":"SUBMITTED"
    })
    .eq("id",task.id);

  res.json({
    ok:true,
    task:data,
    skill,
    matched_workers:workers.data?.length||0,
    workers:workers.data||[]
  });
});

/* WORKER */

app.post("/api/workers",async(req,res)=>{
  const {
    user_id,skills,location,experience,
    availability="available"
  }=req.body;

  if(!user_id||!skills)
    return res.status(400).json({error:"Worker details required"});

  const {data,error}=await supabase
    .from("workers")
    .insert({
      id:uid(),
      user_id,
      skills:Array.isArray(skills)?skills.join(","):skills,
      location,
      experience,
      status:availability,
      rating:0,
      jobs:0,
      created_at:new Date().toISOString()
    })
    .select()
    .single();

  if(error)
    return res.status(400).json({error:error.message});

  res.json({ok:true,worker:data});
});

/* ACCEPT TASK */

app.post("/api/work/:id/accept",async(req,res)=>{
  const {worker_id}=req.body;

  const {data,error}=await supabase
    .from("tasks")
    .update({
      worker_id,
      status:"ACCEPTED"
    })
    .eq("id",req.params.id)
    .select()
    .single();

  if(error)
    return res.status(400).json({error:error.message});

  res.json({ok:true,task:data});
});

/* TASK STATUS */

app.post("/api/work/:id/status",async(req,res)=>{
  const allowed=[
    "IN PROGRESS",
    "SUBMITTED FOR VERIFICATION",
    "VERIFIED",
    "PAYMENT",
    "COMPLETED",
    "CANCELLED",
    "DISPUTED",
    "REASSIGNED"
  ];

  if(!allowed.includes(req.body.status))
    return res.status(400).json({error:"Invalid status"});

  const {data,error}=await supabase
    .from("tasks")
    .update({status:req.body.status})
    .eq("id",req.params.id)
    .select()
    .single();

  if(error)
    return res.status(400).json({error:error.message});

  res.json({ok:true,task:data});
});

/* DEAL ROOM */

app.post("/api/dealrooms",async(req,res)=>{
  const {
    buyer_id,seller_id,listing_id=null,task_id=null
  }=req.body;

  const {data,error}=await supabase
    .from("deal_rooms")
    .insert({
      id:uid(),
      buyer_id,
      seller_id,
      listing_id,
      task_id,
      status:"OPEN",
      created_at:new Date().toISOString()
    })
    .select()
    .single();

  if(error)
    return res.status(400).json({error:error.message});

  res.json({ok:true,room:data});
});

/* CHAT */

app.post("/api/dealrooms/:id/chat",async(req,res)=>{
  const {sender_id,message}=req.body;

  if(!sender_id||!message)
    return res.status(400).json({error:"Message required"});

  if(/(?:\+?254|0)?7\d{8}/.test(message))
    return res.status(400).json({
      error:"Phone numbers are protected until connection is completed."
    });

  const {data,error}=await supabase
    .from("messages")
    .insert({
      id:uid(),
      room_id:req.params.id,
      sender_id,
      message,
      created_at:new Date().toISOString()
    })
    .select()
    .single();

  if(error)
    return res.status(400).json({error:error.message});

  res.json({ok:true,message:data});
});

/* PAYMENT */

app.post("/api/pay",async(req,res)=>{
  const {user_id,room_id,amount,type="connection"}=req.body;

  if(!user_id||!room_id||!amount)
    return res.status(400).json({error:"Payment details required"});

  const {data,error}=await supabase
    .from("payments")
    .insert({
      id:uid(),
      user_id,
      room_id,
      amount,
      type,
      status:"PAID",
      created_at:new Date().toISOString()
    })
    .select()
    .single();

  if(error)
    return res.status(400).json({error:error.message});

  res.json({ok:true,payment:data});
});

/* MEMBERSHIP */

app.post("/api/membership",async(req,res)=>{
  const {user_id,plan}=req.body;

  if(!plans[plan])
    return res.status(400).json({error:"Invalid plan"});

  const {data,error}=await supabase
    .from("members")
    .update({membership:plan})
    .eq("id",user_id)
    .select()
    .single();

  if(error)
    return res.status(400).json({error:error.message});

  res.json({
    ok:true,
    user:data,
    price:plans[plan].price,
    match_fee:plans[plan].match
  });
});

/* REFERRAL */

app.post("/api/referral",async(req,res)=>{
  const {user_id,referral_code}=req.body;

  const ref=await supabase
    .from("members")
    .select("id")
    .eq("referral_code",referral_code)
    .single();

  if(ref.error)
    return res.status(404).json({error:"Referral code not found"});

  if(ref.data.id===user_id)
    return res.status(400).json({error:"Cannot refer yourself"});

  const {error}=await supabase
    .from("members")
    .update({referred_by:ref.data.id})
    .eq("id",user_id);

  if(error)
    return res.status(400).json({error:error.message});

  res.json({ok:true,message:"Referral connected"});
});

/* COUPON */

app.post("/api/coupon",async(req,res)=>{
  const {code}=req.body;

  const {data,error}=await supabase
    .from("coupons")
    .select("*")
    .eq("code",String(code).toUpperCase())
    .eq("active",true)
    .single();

  if(error)
    return res.status(404).json({error:"Coupon not found"});

  res.json({ok:true,coupon:data});
});

/* WHATSAPP */

app.post("/api/webhook/whatsapp",(req,res)=>{
  const body=String(req.body.Body||"").trim().toLowerCase();

  let reply;

  if(body.includes("buy"))
    reply="🔥 JR PHEEF\nSend what you want + location + budget.";

  else if(body.includes("sell"))
    reply="🔥 JR PHEEF SELL\nSend item, price, location and at least 3 photos.";

  else if(
    body.includes("work")||
    body.includes("job")||
    body.includes("task")
  )
    reply="🛠️ JR PHEEF WORK\nTell me the task, location, budget and urgency.";

  else
    reply=
`👋 Welcome to JR PHEEF.

BUY — find something
SELL — list something
WORK — find skilled help

Find. Match. Trade.`;

  const twiml=new twilio.twiml.MessagingResponse();
  twiml.message(reply);

  res.type("text/xml").send(twiml.toString());
});

/* DASHBOARD */

app.get("/dashboard/:id",async(req,res)=>{
  const {data,error}=await supabase
    .from("members")
    .select("*")
    .eq("id",req.params.id)
    .single();

  if(error)
    return res.status(404).send("User not found");

  res.send(`
<!DOCTYPE html>
<html>
<head>
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>JR PHEEF Dashboard</title>
<style>
body{font-family:Arial;background:#08101f;color:white;padding:20px}
.box{background:#151e32;padding:18px;margin:10px 0;border-radius:14px}
</style>
</head>
<body>

<h1>JR PHEEF</h1>
<p>Welcome, ${data.name}</p>

<div class="box">
<b>MARKET</b><br>
Find • Buy • Sell
</div>

<div class="box">
<b>WORK</b><br>
Post Tasks • Find Workers • Manage Jobs
</div>

<div class="box">
<b>DEAL ROOMS</b><br>
Chat • Files • Payment • Activity
</div>

<div class="box">
<b>JR PHEEF PAY</b><br>
Payments • Credits • Rewards
</div>

<div class="box">
<b>REWARDS</b><br>
Credits: KSh ${data.credits||0}<br>
Rewards: KSh ${data.rewards||0}<br>
Minimum withdrawal: KSh 200
</div>

<div class="box">
<b>REFERRAL</b><br>
${data.referral_code}
</div>

<div class="box">
<b>MEMBERSHIP</b><br>
${String(data.membership||"free").toUpperCase()}
</div>

<div class="box">
<b>DELIVERY</b><br>
Riders • Movers • Delivery Partners
</div>

</body>
</html>
`);
});

/* OWNER */

app.get("/owner",async(req,res)=>{
  if(req.query.key!==process.env.OWNER_KEY)
    return res.status(403).send("Forbidden");

  const members=await supabase
    .from("members")
    .select("id,name,phone,membership,created_at")
    .order("created_at",{ascending:false})
    .limit(100);

  const listings=await supabase
    .from("listings")
    .select("*")
    .order("created_at",{ascending:false})
    .limit(100);

  const tasks=await supabase
    .from("tasks")
    .select("*")
    .order("created_at",{ascending:false})
    .limit(100);

  res.json({
    platform:"JR PHEEF",
    members:members.data||[],
    listings:listings.data||[],
    tasks:tasks.data||[]
  });
});

app.listen(PORT,()=>{
  console.log(`JR PHEEF running on port ${PORT}`);
});
