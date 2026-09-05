const express=require("express");
const crypto=require("crypto");
const {createClient}=require("@supabase/supabase-js");
const twilio=require("twilio");
const multer=require("multer");

const app=express(),PORT=process.env.PORT||10000;
const BASE=process.env.BASE_URL||"https://jr-pheef-marketplace.onrender.com";
const URL=process.env.SUPABASE_URL;
const KEY=process.env.SUPABASE_SECRET_KEY||process.env.SUPABASE_SERVICE_ROLE_KEY||process.env.SUPABASE_ANON_KEY;
const db=URL&&KEY?createClient(URL,KEY):null;
const tw=process.env.TWILIO_ACCOUNT_SID&&process.env.TWILIO_AUTH_TOKEN
  ?twilio(process.env.TWILIO_ACCOUNT_SID,process.env.TWILIO_AUTH_TOKEN):null;
const FROM=process.env.TWILIO_WHATSAPP_NUMBER;

const upload=multer({
  storage:multer.memoryStorage(),
  limits:{fileSize:5*1024*1024}
});

app.use(express.urlencoded({extended:true}));
app.use(express.json());

const clean=x=>String(x??"").trim();

const esc=x=>clean(x).replace(/[&<>"']/g,c=>({
  "&":"&amp;",
  "<":"&lt;",
  ">":"&gt;",
  '"':"&quot;",
  "'":"&apos;"
}[c]));

const phone=x=>{
  let p=clean(x)
    .replace(/^whatsapp:/i,"")
    .replace(/[\s().-]/g,"");

  if(/^07\d{8}$/.test(p))p="+254"+p.slice(1);
  if(/^2547\d{8}$/.test(p))p="+"+p;

  return p;
};

const money=x=>Number(x||0).toLocaleString("en-KE");

const xml=x=>`<Response><Message>${esc(x)}</Message></Response>`;

const salt=()=>process.env.PASSWORD_SALT||"jr-pheef-salt";

const scrypt=p=>
  crypto.scryptSync(clean(p),salt(),32).toString("hex");

const sha=p=>
  crypto.createHash("sha256").update(clean(p)).digest("hex");

const blocked=
  /((\+?\d[\d\s().-]{7,})|\b\d{9,13}\b|https?:\/\/|www\.|\.com\b|\.co\.ke\b|@[\w.-]+|\bwhatsapp\b|\btelegram\b|\bemail\b)/i;

async function getMember(p){
  if(!db)return null;
  const r=await db.from("members")
    .select("*")
    .eq("phone",phone(p))
    .maybeSingle();
  return r.data||null;
}

async function getListing(id){
  const r=await db.from("jr_listings")
    .select("*")
    .eq("id",id)
    .maybeSingle();
  return r.data||null;
}

async function getRooms(p){
  const r=await db.from("deal_rooms")
    .select("*")
    .or(`buyer_phone.eq.${phone(p)},seller_phone.eq.${phone(p)}`)
    .in("status",["negotiating","agreed","paid"])
    .order("created_at",{ascending:false});

  if(r.error)console.error("ROOMS:",r.error.message);
  return r.data||[];
}

async function createRoom(l,b){
  b=phone(b);

  if(!l||phone(l.phone||"")===b)return null;

  const old=await db.from("deal_rooms")
    .select("*")
    .eq("listing_id",l.id)
    .eq("buyer_phone",b)
    .in("status",["negotiating","agreed","paid"])
    .limit(1);

  if(old.data?.[0])return old.data[0];

  const r=await db.from("deal_rooms")
    .insert({
      listing_id:l.id,
      buyer_phone:b,
      seller_phone:phone(l.phone),
      status:"negotiating",
      buyer_paid:false,
      seller_paid:false,
      buyer_agreed:false,
      seller_agreed:false
    })
    .select()
    .single();

  if(r.error){
    console.error("CREATE ROOM:",r.error.message);
    return null;
  }

  return r.data;
}

async function send(to,body,media){
  if(!tw||!FROM)return;

  try{
    await tw.messages.create({
      from:FROM,
      to:`whatsapp:${phone(to)}`,
      body,
      ...(media?{mediaUrl:media}:{})
    });
  }catch(e){
    console.error("TWILIO:",e.message);
  }
}

function page(title,body){
  return `<!doctype html>
<html>
<head>
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>${esc(title)}</title>
<style>
body{
font-family:Arial;
margin:0;
background:#f3f8f5;
color:#111
}
header{
background:#08783c;
color:white;
padding:22px
}
main{
max-width:850px;
margin:auto;
padding:15px
}
.card{
background:white;
padding:18px;
margin:12px 0;
border-radius:16px;
box-shadow:0 2px 10px #0001
}
input,textarea,select{
width:100%;
padding:12px;
margin:5px 0;
border:1px solid #ccc;
border-radius:9px;
box-sizing:border-box
}
button,.btn{
background:#08783c;
color:white;
padding:11px 15px;
border:0;
border-radius:9px;
text-decoration:none;
display:inline-block;
margin:4px
}
.grid{
display:grid;
grid-template-columns:repeat(auto-fit,minmax(220px,1fr));
gap:10px
}
.muted{
opacity:.7;
font-size:13px
}
img{
max-width:100%;
border-radius:12px
}
</style>
</head>
<body>${body}</body>
</html>`;
}


/* HOME */

app.get("/",(req,res)=>res.send(page("JR PHEEF",`
<header>
<h1>JR PHEEF</h1>
<p>Find. Match. Trade.</p>
</header>

<main>
<div class="card">
<h2>Welcome to JR PHEEF</h2>
<p>Find people, products, services, jobs, property, business and opportunities.</p>

<a class="btn" href="/register">Create account</a>
<a class="btn" href="/login">Sign in</a>
</div>
</main>
`)));


/* REGISTER */

app.get("/register",(req,res)=>res.send(page("Create account",`
<main>
<div class="card">
<h2>Create JR PHEEF account</h2>

<form method="post">

<input name="full_name"
placeholder="Full name"
required>

<input name="phone"
placeholder="Phone e.g. 0712345678"
required>

<input name="birth_year"
type="number"
placeholder="Birth year">

<input name="password"
id="pw"
type="password"
placeholder="Password"
required>

<label>
<input type="checkbox"
onclick="pw.type=this.checked?'text':'password'">
Show password
</label>

<button>Create account</button>

</form>

<p>
<a href="/login">Already registered? Sign in</a>
</p>

</div>
</main>
`)));


app.post("/register",async(req,res)=>{
  if(!db)return res.status(500).send("Database not configured");

  const p=phone(req.body.phone);

  if(!p)return res.status(400).send("Invalid phone");

  const old=await getMember(p);

  if(old){
    return res.status(409).send(page("Account exists",`
    <main>
    <div class="card">
    <h2>Account already exists</h2>
    <a class="btn" href="/login">Sign in</a>
    </div>
    </main>
    `));
  }

  const c=await db
    .from("members")
    .select("id",{count:"exact",head:true});

  const dgbo=`DGBO-${String((c.count||0)+1).padStart(6,"0")}`;

  const row={
    dgbo_id:dgbo,
    full_name:clean(req.body.full_name),
    phone:p,
    birth_year:parseInt(req.body.birth_year)||null,
    password_hash:scrypt(req.body.password),
    verified:false,
    status:"active",
    plan:"free",
    rewards:0,
    credits:0,
    referrals:0,
    theme:"green",
    account_type:"individual",
    bio:"",
    location:"",
    country:"Kenya",
    public_profile:true,
    public_phone:false
  };

  const q=await db.from("members").insert(row);

  if(q.error){
    console.error("REGISTER:",q.error.message);
    return res.status(500).send(
      "Could not create account: "+esc(q.error.message)
    );
  }

  res.redirect(`/home?id=${encodeURIComponent(dgbo)}`);
});


/* LOGIN */

app.get("/login",(req,res)=>res.send(page("Sign in",`
<main>
<div class="card">

<h2>Sign in</h2>

<form method="post">

<input
name="phone"
placeholder="Phone"
required>

<input
name="password"
id="pw"
type="password"
placeholder="Password"
required>

<label>
<input type="checkbox"
onclick="pw.type=this.checked?'text':'password'">
Show password
</label>

<button>Sign in</button>

</form>

<p>
<a href="/register">Create account</a>
</p>

</div>
</main>
`)));


app.post("/login",async(req,res)=>{
  const u=await getMember(req.body.phone);

  if(!u)
    return res.status(401).send("Incorrect phone or password");

  const p=clean(req.body.password);

  let ok=u.password_hash===scrypt(p);

  /* Support old SHA-256 accounts */
  if(!ok)ok=u.password_hash===sha(p);

  if(!ok)
    return res.status(401).send("Incorrect phone or password");

  /* Upgrade old password hash */
  if(u.password_hash!==scrypt(p)){
    await db.from("members")
      .update({password_hash:scrypt(p)})
      .eq("id",u.id);
  }

  res.redirect(`/home?id=${encodeURIComponent(u.id)}`);
});


/* HOME DASHBOARD */

app.get("/home",async(req,res)=>{
  let u=await db.from("members")
    .select("*")
    .eq("id",req.query.id)
    .maybeSingle();

  if(!u.data){
    u=await db.from("members")
      .select("*")
      .eq("dgbo_id",req.query.id)
      .maybeSingle();
  }

  u=u.data;

  if(!u)return res.redirect("/login");

  res.send(page("JR PHEEF Home",`

<header>
<h1>JR PHEEF</h1>
<p>Find. Match. Trade.</p>
</header>

<main>

<div class="card">

<h2>👋 ${esc(u.full_name)}</h2>

<p>
${esc(u.dgbo_id||"")}
·
${esc(u.phone)}
</p>

<p>
${esc(u.bio||"Tell people about yourself.")}
</p>

</div>


<div class="grid">

<div class="card">

<h3>🔎 FIND</h3>

<form action="/find">

<input
name="item"
placeholder="What are you looking for?"
required>

<input
name="location"
placeholder="Location">

<input
name="budget"
placeholder="Maximum budget">

<button>Find</button>

</form>

</div>


<div class="card">

<h3>➕ CREATE</h3>

<form
action="/listing"
method="post"
enctype="multipart/form-data">

<input
type="hidden"
name="member_id"
value="${esc(u.id)}">

<input
name="item_name"
placeholder="What are you offering?"
required>

<input
name="price"
placeholder="Price"
required>

<input
name="location"
placeholder="Location"
required>

<textarea
name="description"
placeholder="Description">
</textarea>

<input
name="photos"
type="file"
accept="image/*"
multiple>

<button>Create</button>

</form>

</div>

</div>


<div class="card">

<h3>🔐 Deal Rooms</h3>

<a class="btn"
href="/deals?id=${encodeURIComponent(u.id)}">
Open Deal Rooms
</a>

<a class="btn"
href="/wallet?id=${encodeURIComponent(u.id)}">
Wallet
</a>

<a class="btn"
href="/profile?id=${encodeURIComponent(u.id)}">
Profile
</a>

</div>


<div class="card">

<h3>⏱ Marketplace Access</h3>

<p>
<b>KSh 30 = 5 hours</b> of active marketplace access.
</p>

<p>
🌙 Free daily window:
<b>02:00–06:00 Kenya time</b>
</p>

<p>
No automatic charging.
</p>

</div>

</main>
`));
});


/* PROFILE */

app.get("/profile",async(req,res)=>{
  const u=await getMember(req.query.id);

  if(!u)return res.redirect("/login");

  res.send(page("Profile",`

<main>

<div class="card">

<h2>Profile</h2>

<form
method="post"
action="/profile"
enctype="multipart/form-data">

<input
type="hidden"
name="id"
value="${esc(u.id)}">

<input
name="full_name"
value="${esc(u.full_name)}">

<textarea
name="bio"
placeholder="Bio">${esc(u.bio||"")}</textarea>

<input
name="location"
value="${esc(u.location||"")}"
placeholder="Location">

<input
name="country"
value="${esc(u.country||"Kenya")}"
placeholder="Country">

<label>
<input
type="checkbox"
name="public_profile"
${u.public_profile!==false?"checked":""}>
Public profile
</label>

<br>

<label>
<input
type="checkbox"
name="public_phone"
${u.public_phone?"checked":""}>
Public phone
</label>

<br>

<input
name="photo"
type="file"
accept="image/*">

<button>Save profile</button>

</form>

</div>

</main>

`));
});


app.post("/profile",upload.single("photo"),async(req,res)=>{
  const data={
    full_name:clean(req.body.full_name),
    bio:clean(req.body.bio),
    location:clean(req.body.location),
    country:clean(req.body.country),
    public_profile:!!req.body.public_profile,
    public_phone:!!req.body.public_phone
  };

  if(req.file&&db){

    const path=
      `${req.body.id}/${Date.now()}-${crypto.randomBytes(4).toString("hex")}`;

    const up=await db.storage
      .from("profiles")
      .upload(
        path,
        req.file.buffer,
        {
          contentType:req.file.mimetype,
          upsert:true
        }
      );

    if(!up.error){
      data.profile_photo=
        db.storage
        .from("profiles")
        .getPublicUrl(path)
        .data.publicUrl;
    }
  }

  const q=await db
    .from("members")
    .update(data)
    .eq("id",req.body.id);

  if(q.error)
    return res.status(500).send(q.error.message);

  res.redirect(`/home?id=${encodeURIComponent(req.body.id)}`);
});


/* FIND */

app.get("/find",async(req,res)=>{
  const item=clean(req.query.item);
  const loc=clean(req.query.location);

  const budget=
    parseInt(
      String(req.query.budget||"")
      .replace(/\D/g,"")
    )||0;

  let q=db.from("jr_listings")
    .select("*")
    .eq("status","ACTIVE")
    .ilike("item_name",`%${item}%`);

  if(loc)
    q=q.ilike("location",`%${loc}%`);

  if(budget)
    q=q.lte("price",budget);

  const r=await q
    .order("created_at",{ascending:false});

  res.send(page("Find",`

<main>

<div class="card">

<h2>
🔎 Results for ${esc(item)}
</h2>

${
r.error
?`<p>${esc(r.error.message)}</p>`
:
r.data?.length
?
r.data.map(x=>`

<div class="card">

<h3>${esc(x.item_name)}</h3>

<p>
💰 KSh ${money(x.price)}
·
📍 ${esc(x.location)}
</p>

<p>
${esc(x.description||"")}
</p>

<a
class="btn"
href="/match?listing=${encodeURIComponent(x.id)}">
Connect
</a>

</div>

`).join("")
:
"<p>No match yet.</p>"
}

</div>

</main>

`));
});


/* CREATE LISTING */

app.post("/listing",upload.array("photos",5),async(req,res)=>{

  const photos=[];

  for(const f of req.files||[]){

    const path=
      `listings/${Date.now()}-${crypto.randomBytes(4).toString("hex")}`;

    const up=await db.storage
      .from("listings")
      .upload(
        path,
        f.buffer,
        {
          contentType:f.mimetype,
          upsert:true
        }
      );

    if(!up.error){

      photos.push(
        db.storage
        .from("listings")
        .getPublicUrl(path)
        .data.publicUrl
      );

    }
  }

  const row={
    seller_id:req.body.member_id,
    item_name:clean(req.body.item_name),
    price:
      parseInt(
        String(req.body.price)
        .replace(/\D/g,"")
      )||0,
    location:clean(req.body.location),
    description:clean(req.body.description),
    photos,
    status:"ACTIVE"
  };

  const q=await db
    .from("jr_listings")
    .insert(row);

  if(q.error)
    return res.status(500)
      .send("Listing error: "+esc(q.error.message));

  res.redirect(
    `/home?id=${encodeURIComponent(req.body.member_id)}`
  );
});


/* MATCH */

app.get("/match",async(req,res)=>{

  const l=await getListing(req.query.listing);

  if(!l)
    return res.status(404).send("Listing not found");

  const u=await getMember(req.query.id);

  if(!u){

    return res.send(page("Connect",`

    <main>
    <div class="card">

    <h2>${esc(l.item_name)}</h2>

    <p>
    Sign in first to create the connection.
    </p>

    <a class="btn" href="/login">
    Sign in
    </a>

    </div>
    </main>

    `);
  }

  const seller=await getMember(l.seller_id);

  const r=await createRoom({
    ...l,
    phone:seller?.phone||l.phone
  },u.phone);

  res.send(page("Deal Room",`

  <main>

  <div class="card">

  <h2>🔐 Deal Room</h2>

  <p>
  ${esc(l.item_name)}
  ·
  KSh ${money(l.price)}
  </p>

  <p>
  ${
    r
    ?"Connection created. Chat normally inside JR PHEEF."
    :"Could not create room."
  }
  </p>

  <a
  class="btn"
  href="/deals?id=${encodeURIComponent(u.id)}">
  Open Deal Rooms
  </a>

  </div>

  </main>

  `));
});


/* DEAL ROOMS */

app.get("/deals",async(req,res)=>{

  const u=await getMember(req.query.id);

  if(!u)return res.redirect("/login");

  const rs=await getRooms(u.phone);

  res.send(page("Deal Rooms",`

  <main>

  <div class="card">

  <h2>🔐 Deal Rooms</h2>

  ${
    rs.length
    ?
    rs.map((r,i)=>`

    <div class="card">

    <b>Room ${i+1}</b>

    <p>
    Status: ${esc(r.status)}
    </p>

    <a
    class="btn"
    href="/room?id=${encodeURIComponent(r.id)}&member=${encodeURIComponent(u.id)}">
    CHAT
    </a>

    </div>

    `).join("")
    :
    "<p>No active Deal Rooms.</p>"
  }

  </div>

  </main>

  `));
});


/* DEAL ROOM CHAT */

app.get("/room",async(req,res)=>{

  const u=await getMember(req.query.member);

  const r=
    (
      await db
      .from("deal_rooms")
      .select("*")
      .eq("id",req.query.id)
      .maybeSingle()
    ).data;

  if(!u||!r)
    return res.status(404).send("Room not found");

  if(
    phone(u.phone)!==phone(r.buyer_phone)&&
    phone(u.phone)!==phone(r.seller_phone)
  )
    return res.status(403).send("Not allowed");

  const ms=await db
    .from("messages")
    .select("*")
    .eq("room_id",r.id)
    .order("created_at");

  res.send(page("Deal Room",`

  <main>

  <div class="card">

  <h2>🔐 Deal Room</h2>

  ${
    (ms.data||[])
    .map(m=>`

    <p>
    <b>
    ${
      phone(m.sender_phone)===phone(u.phone)
      ?"You"
      :"Other"
    }:
    </b>
    ${esc(m.message)}
    </p>

    `).join("")
  }

  <form
  method="post"
  action="/message">

  <input
  type="hidden"
  name="room_id"
  value="${esc(r.id)}">

  <input
  type="hidden"
  name="member_id"
  value="${esc(u.id)}">

  <textarea
  name="message"
  placeholder="Type normally..."
  required>
  </textarea>

  <button>Send</button>

  </form>

  </div>

  </main>

  `));
});


/* CHAT MESSAGE */

app.post("/message",async(req,res)=>{

  const u=await getMember(req.body.member_id);

  const r=
    (
      await db
      .from("deal_rooms")
      .select("*")
      .eq("id",req.body.room_id)
      .maybeSingle()
    ).data;

  const m=clean(req.body.message);

  if(!u||!r)
    return res.status(404).send("Not found");

  if(
    phone(u.phone)!==phone(r.buyer_phone)&&
    phone(u.phone)!==phone(r.seller_phone)
  )
    return res.status(403).send("Not allowed");

  if(blocked.test(m))
    return res.status(400).send(
      "For safety, phone numbers, emails and external links are not allowed in JR PHEEF chat."
    );

  const q=await db
    .from("messages")
    .insert({
      room_id:r.id,
      sender_phone:u.phone,
      message:m
    });

  if(q.error)
    return res.status(500).send(q.error.message);

  const other=
    phone(u.phone)===phone(r.buyer_phone)
    ?r.seller_phone
    :r.buyer_phone;

  await send(
    other,
    `💬 JR PHEEF Deal Room\n\n${m}`
  );

  res.redirect(
    `/room?id=${encodeURIComponent(r.id)}&member=${encodeURIComponent(u.id)}`
  );
});


/* WALLET */

app.get("/wallet",async(req,res)=>{

  const u=await getMember(req.query.id);

  if(!u)return res.redirect("/login");

  res.send(page("Wallet",`

  <main>

  <div class="card">

  <h2>💳 JR PHEEF Wallet</h2>

  <p>
  Rewards:
  <b>KSh ${money(u.rewards)}</b>
  </p>

  <p>
  Credits:
  <b>KSh ${money(u.credits)}</b>
  </p>

  <p>
  Referrals:
  <b>${u.referrals||0}</b>
  </p>

  <p>
  Minimum individual withdrawal:
  <b>KSh 200</b>
  </p>

  <hr>

  <p>
  Marketplace access:
  <b>KSh 30 / 5 hours</b>
  </p>

  <p>
  Free window:
  <b>02:00–06:00 Kenya time</b>
  </p>

  </div>

  </main>

  `));
});


/* WHATSAPP */

app.post("/api/webhook/whatsapp",async(req,res)=>{

  try{

    const msg=clean(req.body.Body);
    const p=phone(req.body.From);
    const u=await getMember(p);
    const up=msg.toUpperCase();

    console.log("📩 WHATSAPP:",p,msg);

    if(!u){

      return res
        .type("text/xml")
        .send(
          xml(
            `👋 Karibu JR PHEEF!\n\nCreate your account here:\n${BASE}/register`
          )
        );

    }


    const rs=await getRooms(p);


    /* DEALS */

    if(/^DEALS$/i.test(msg)){

      return res
        .type("text/xml")
        .send(
          xml(
            rs.length
            ?
            rs.map((r,i)=>
              `${i+1}. 🔐 Deal Room — ${r.status}\nReply CHAT ${i+1}`
            ).join("\n\n")
            :
            "📂 You have no active Deal Rooms."
          )
        );

    }


    /* CHAT */

    if(/^CHAT(\s+\d+)?$/i.test(msg)){

      const n=
        parseInt(msg.split(/\s+/)[1]||"1")-1;

      const r=rs[n];

      return res
        .type("text/xml")
        .send(
          xml(
            r
            ?
            "🔐 Deal Room ready.\n\nType your message normally."
            :
            "❌ No such Deal Room."
          )
        );

    }


    /* CONTACT PROTECTION */

    if(blocked.test(msg)){

      return res
        .type("text/xml")
        .send(
          xml(
            "🔒 For safety, JR PHEEF does not allow phone numbers, emails or external links in chat."
          )
        );

    }


    /* GREETING */

    if(
      /^(HI|HELLO|HEY|START|MENU)$/i.test(msg)
    ){

      return res
        .type("text/xml")
        .send(
          xml(
`👋 ${u.full_name}, karibu JR PHEEF.

Tell me naturally what you are looking for or what you want to create.

You can use English, Sheng, or mix both.

Your account:
${BASE}/home?id=${u.id}`
          )
        );

    }


    /* SELLING */

    const sell=
      /(selling|sell|nauza|niko na|i have|available)/i
      .test(msg);

    if(sell){

      return res
        .type("text/xml")
        .send(
          xml(
`📣 Tell me what you are offering, price and location.

You can also send up to 5 photos together.`
          )
        );

    }


    /* NATURAL FIND */

    const term=
      msg.replace(
        /^(i am|i'm|looking for|find|need|natafuta)\s+/i,
        ""
      );


    const q=await db
      .from("jr_listings")
      .select("*")
      .eq("status","ACTIVE")
      .ilike("item_name",`%${term}%`)
      .limit(5);

    const l=
      (q.data||[])
      .find(x=>
        phone(x.phone||"")!==p &&
        x.seller_id!==u.id
      );


    if(l){

      const seller=
        await getMember(l.seller_id);

      const r=
        await createRoom(
          {
            ...l,
            phone:seller?.phone||l.phone
          },
          u.phone
        );


      if(r){

        await send(
          seller?.phone||l.phone,
`🎉 JR PHEEF MATCH!

${l.item_name}
💰 KSh ${money(l.price)}
📍 ${l.location}

🔐 Secure Deal Room created.

Your phone number remains protected.`
        );


        return res
          .type("text/xml")
          .send(
            xml(
`🎉 I found a match!

${l.item_name}
💰 KSh ${money(l.price)}
📍 ${l.location}

🔐 Secure Deal Room created.

Type CHAT to continue.`
            )
          );

      }

    }


    /* NORMAL DEAL ROOM CHAT */

    if(rs.length){

      const r=rs[0];

      const other=
        p===r.buyer_phone
        ?r.seller_phone
        :r.buyer_phone;


      await db
        .from("messages")
        .insert({
          room_id:r.id,
          sender_phone:p,
          message:msg
        });


      await send(
        other,
        `💬 JR PHEEF Deal Room\n\n${msg}`
      );


      return res
        .type("text/xml")
        .send(
          xml(
            "☑️ Message sent through your secure Deal Room."
          )
        );

    }


    return res
      .type("text/xml")
      .send(
        xml(
`👋 ${u.full_name}, tell me naturally what you are looking for or offering.

You can also use:
${BASE}/home?id=${u.id}`
        )
      );

  }catch(e){

    console.error("🔥 WEBHOOK ERROR:",e);

    return res
      .type("text/xml")
      .send(
        xml(
          "JR PHEEF is temporarily unavailable. Please try again."
        )
      );

  }

});


/* HEALTH */

app.get("/health",(req,res)=>{

  res.json({
    ok:true,
    db:!!db,
    whatsapp:!!tw,
    listings:"jr_listings",
    access:"KSh 30 / 5 hours",
    free_window:"02:00-06:00 EAT"
  });

});


app.listen(PORT,()=>{

  console.log(
`🚀 JR PHEEF running on ${PORT} |
DB ${db?"CONNECTED":"NOT CONNECTED"} |
LISTINGS jr_listings |
ACCESS KSh30/5h |
FREE 02:00-06:00 EAT`
  );

});
