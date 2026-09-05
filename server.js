`<main><div class=card><h2>Forgot password?</h2><p>Enter your registered phone and JR PHEEF will send a reset code on WhatsApp.</p><form method=post><input name=phone placeholder="07XXXXXXXX" required><button>Send reset code</button></form></div></main>`)));

app.post("/forgot",async(req,r)=>{try{
 let p=phone(req.body.phone),u=await member(p);
 if(!u)return r.send("If that account exists, a reset code has been sent. <a href=/reset>Enter code</a>");
 let code=String(crypto.randomInt(100000,1000000));reset.set(p,{code,expires:Date.now()+600000});
 await send(p,`🔐 JR PHEEF password reset code: ${code}\n\nValid for 10 minutes. If you did not request this, ignore it.`);
 r.redirect(`/reset?phone=${encodeURIComponent(p)}`)
}catch(e){console.error("FORGOT",e);r.status(500).send("Could not send reset code")}});

app.get("/reset",req=>{}); // replaced below

app.get("/reset",(req,r)=>r.send(page("Reset password",`<main><div class=card><h2>Reset password</h2><form method=post><input name=phone value="${esc(req.query.phone)}" placeholder="Phone" required><input name=code inputmode=numeric placeholder="6-digit code" required><input id=p name=password type=password placeholder="New password" required><input id=c name=confirm_password type=password placeholder="Confirm new password" required><label><input type=checkbox onclick="p.type=this.checked?'text':'password';c.type=this.checked?'text':'password'"> Show passwords</label><button>Reset password</button></form></div></main>`)));

app.post("/reset",async(req,r)=>{try{
 let p=phone(req.body.phone),x=reset.get(p);
 if(!x||x.expires<Date.now()||x.code!==clean(req.body.code))return r.send("Invalid or expired reset code. <a href=/forgot>Request another</a>");
 if(req.body.password!==req.body.confirm_password)return r.send("Passwords do not match. <a href=/reset>Try again</a>");
 let{error}=await db.from("members").update({password_hash:hash(req.body.password)}).eq("phone",p);
 if(error)throw error;reset.delete(p);r.send("✅ Password reset successfully. <a href=/login>Sign in</a>")
}catch(e){console.error("RESET",e);r.status(500).send("Password reset error")}});

app.get("/home",async(req,r)=>{let{data:u}=await db.from("members").select("*").eq("id",req.query.id).maybeSingle();if(!u)return r.status(404).send("Member not found");r.send(page("JR PHEEF Home",`<header><h1>JR PHEEF</h1><p>${esc(u.full_name)} • ${esc(u.dgbo_id)}</p></header><main><div class=card><h2>🔎 FIND</h2><form action=/find><input name=item placeholder="What are you looking for?"><input name=location placeholder="Location"><input name=budget type=number placeholder="Maximum budget"><input type=hidden name=member value="${esc(u.id)}"><button>Find</button></form></div><div class=card><h2>📣 CREATE</h2><form action=/listing method=post><input type=hidden name=member value="${u.id}"><input name=item_name placeholder="Item / service / opportunity" required><input name=price type=number placeholder="Price" required><input name=location placeholder="Location" required><textarea name=description placeholder="Description"></textarea><button>Create</button></form></div><div class=card>DGBO ID: <b>${esc(u.dgbo_id)}</b><br>Rewards: KSh ${money(u.rewards)}<br>Credits: KSh ${money(u.credits)}<br><br>Marketplace access: <b>KSh 30 / 5 hours</b><br>Free daily: <b>02:00–06:00 EAT</b><br><a class=btn href="/deals?id=${u.id}">Deal Rooms</a><a class=btn href="/wallet?id=${u.id}">Wallet</a></div></main>`))});

app.get("/find",async(req,r)=>{let m=await find(clean(req.query.item),clean(req.query.location),Number(req.query.budget)||null),cards=m.slice(0,20).map(x=>`<div class=card><b>${esc(x.item_name)}</b><br>KSh ${money(x.price)}<br>${esc(x.location)}<br>${esc(x.description||"")}<form method=post action=/match><input type=hidden name=listing_id value="${esc(x.id)}"><input type=hidden name=buyer value="${esc(req.query.member||"")}"><button>Connect</button></form></div>`).join("");r.send(page("Find",`<main><div class=card><h2>Matches</h2>${cards||"No matching opportunities yet."}</div></main>`))});

app.post("/listing",async(req,r)=>{try{let{data:u}=await db.from("members").select("*").eq("id",req.body.member).maybeSingle();if(!u)return r.send("Member not found");let{error}=await db.from("jr_listings").insert({seller_name:u.full_name,phone:u.phone,item_name:clean(req.body.item_name),price:Number(req.body.price)||0,location:clean(req.body.location),description:clean(req.body.description),photos:[],status:"ACTIVE"});if(error)throw error;r.redirect(`/home?id=${u.id}`)}catch(e){console.error("LIST",e);r.status(500).send("Could not create opportunity: "+esc(e.message))}});

app.post("/match",async(req,r)=>{try{let{data:l}=await db.from("jr_listings").select("*").eq("id",req.body.listing_id).single(),{data:u}=await db.from("members").select("*").eq("id",req.body.buyer).maybeSingle();if(!l||!u)return r.send("Match unavailable");let x=await room(l,u.phone);if(!x)return r.send("You cannot match your own opportunity.");try{await send(l.phone,`🎉 JR PHEEF MATCH FOUND!\n\n${l.item_name}\nKSh ${money(l.price)}\n📍 ${l.location}\n\n🔐 Secure Deal Room created.`)}catch(e){}r.redirect(`/deals?id=${u.id}`)}catch(e){console.error("MATCH",e);r.status(500).send("Match error")}});

app.get("/deals",async(req,r)=>{let{data:u}=await db.from("members").select("*").eq("id",req.query.id).maybeSingle();if(!u)return r.send("Member not found");let rs=await rooms(u.phone),cards=rs.map(x=>{let l=x.jr_listings||{};return`<div class=card><b>${esc(l.item_name||"Opportunity")}</b><br>KSh ${money(l.price)} • ${esc(l.location||"")}<br>Status: ${esc(x.status)}<form method=post action=/message><input type=hidden name=room_id value="${esc(x.id)}"><input type=hidden name=phone value="${esc(u.phone)}"><input type=hidden name=member value="${esc(u.id)}"><input name=message placeholder="Type a normal message" required><button>Send</button></form></div>`}).join("")||"No active Deal Rooms.";r.send(page("Deal Rooms",`<main><div class=card><h2>🔐 Deal Rooms</h2>${cards}</div></main>`))});

app.post("/message",async(req,r)=>{try{if(block.test(req.body.message))return r.send("For safety, JR PHEEF does not allow phone numbers, links, email or external contact details.");let{data:x}=await db.from("deal_rooms").select("*").eq("id",req.body.room_id).single(),p=phone(req.body.phone);if(!x||![phone(x.buyer_phone),phone(x.seller_phone)].includes(p))return r.send("Not authorised");let{error}=await db.from("messages").insert({room_id:x.id,sender_phone:p,message:clean(req.body.message)});if(error)throw error;let to=p===phone(x.buyer_phone)?x.seller_phone:x.buyer_phone;try{await send(to,`💬 JR PHEEF DEAL ROOM\n\n${clean(req.body.message)}`)}catch(e){}r.redirect(`/deals?id=${encodeURIComponent(req.body.member)}`)}catch(e){console.error("MESSAGE",e);r.status(500).send("Message error")}});

app.get("/wallet",async(req,r)=>{let{data:u}=await db.from("members").select("*").eq("id",req.query.id).maybeSingle();r.send(page("Wallet",`<main><div class=card><h2>JR PHEEF Wallet</h2>Rewards: KSh ${money(u?.rewards)}<br>Credits: KSh ${money(u?.credits)}<br>Referrals: ${money(u?.referrals)}<br><br>Minimum individual withdrawal: KSh 200.</div></main>`))});

app.post("/api/webhook/whatsapp",async(req,r)=>{try{
 let p=phone(req.body.From),text=clean(req.body.Body),u=await member(p),up=text.toUpperCase();
 if(!u)return r.type("text/xml").send(xml(`👋 Karibu JR PHEEF!\n\nCreate your account:\n${BASE}/register`));
 if(!text)return r.type("text/xml").send(xml(`👋 ${u.full_name}, tell me naturally what you need or what you have.`));
 if(up==="CHAT"){let rs=await rooms(p),x=rs[0],l=x?.jr_listings||{};return r.type("text/xml").send(xml(x?`🔐 DEAL ROOM\n\n${l.item_name||"Opportunity"}\nKSh ${money(l.price)}\n📍 ${l.location||""}\n\nType your message normally.`:"No active Deal Room yet."))}
 if(up.startsWith("FIND")){let a=text.split(/\n/).map(clean),m=await find(a[1],a[2],parseInt((a[3]||"").replace(/\D/g,""))||null),l=m.find(x=>phone(x.phone)!==p);if(!l)return r.type("text/xml").send(xml("😔 I have not found a match yet. I'll keep looking."));let x=await room(l,p);if(!x)return r.type("text/xml").send(xml("I could not create the secure Deal Room."));try{await send(l.phone,`🎉 JR PHEEF MATCH FOUND!\n\n${l.item_name}\nKSh ${money(l.price)}\n📍 ${l.location}\n\n🔐 Secure Deal Room created.`)}catch(e){}return r.type("text/xml").send(xml(`🎉 Match found!\n\n${l.item_name}\nKSh ${money(l.price)}\n📍 ${l.location}\n\n🔐 Secure Deal Room created.`))}
 if(up.startsWith("OPPORTUNITY")){let a=text.split(/\n/).map(clean),item=a[1],price=parseInt((a[2]||"").replace(/\D/g,"")),loc=a[3];if(!item||!price||!loc)return r.type("text/xml").send(xml("Send:\nOPPORTUNITY\nItem\nPrice\nLocation"));let{error}=await db.from("jr_listings").insert({seller_name:u.full_name,phone:p,item_name:item,price,location:loc,description:a.slice(4).join(" "),photos:[],status:"ACTIVE"});if(error)throw error;return r.type("text/xml").send(xml("✅ Opportunity listed. Send your photos and JR PHEEF will look for matches."))}
 let rs=await rooms(p);
 if(rs.length){let x=rs[0],other=p===phone(x.buyer_phone)?x.seller_phone:x.buyer_phone;if(block.test(text))return r.type("text/xml").send(xml("For safety, JR PHEEF does not allow phone numbers, links, email or external contact details."));await db.from("messages").insert({room_id:x.id,sender_phone:p,message:text});try{await send(other,`💬 JR PHEEF DEAL ROOM\n\n${text}`)}catch(e){}return r.type("text/xml").send(xml("☑️ Message sent through your secure Deal Room."))}
 return r.type("text/xml").send(xml(`👋 ${u.full_name}, tell me naturally what you need or what you have.`))
}catch(e){console.error("WEBHOOK",e);return r.type("text/xml").send(xml("JR PHEEF is temporarily unavailable. Please try again."))}});

app.get("/health",(_,r)=>r.json({ok:true,db:!!db,whatsapp:!!wa,listings:"jr_listings",access:"KSh 30 / 5 hours",free_window:"02:00-06:00 EAT",password_reset:true}));
app.listen(PORT,()=>console.log(`🚀 JR PHEEF running on ${PORT} | DB ${db?"CONNECTED":"NOT CONNECTED"} | LISTINGS jr_listings | PASSWORD RESET ON`));
const express=require("express"),crypto=require("crypto"),bcrypt=require("bcryptjs"),{createClient}=require("@supabase/supabase-js"),twilio=require("twilio");

const app=express(),PORT=process.env.PORT||10000;
const BASE=process.env.BASE_URL||"https://jr-pheef-marketplace.onrender.com";
const KEY=process.env.SUPABASE_SECRET_KEY||process.env.SUPABASE_SERVICE_ROLE_KEY||process.env.SUPABASE_ANON_KEY;
const db=process.env.SUPABASE_URL&&KEY?createClient(process.env.SUPABASE_URL,KEY):null;
const tw=process.env.TWILIO_ACCOUNT_SID&&process.env.TWILIO_AUTH_TOKEN?twilio(process.env.TWILIO_ACCOUNT_SID,process.env.TWILIO_AUTH_TOKEN):null;
const FROM=process.env.TWILIO_WHATSAPP_NUMBER,TILL=process.env.JR_PHEEF_TILL||"9270365";
const PASS_FEE=30,PASS_HOURS=5;

app.use(express.urlencoded({extended:false}));
app.use(express.json());

const clean=x=>String(x??"").trim();
const esc=x=>clean(x).replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;").replace(/"/g,"&quot;");
const money=x=>Number(x||0).toLocaleString("en-KE");

function phone(x){
  let p=clean(x).replace(/^whatsapp:/i,"").replace(/[\s().-]/g,"");
  if(/^254[17]\d{8}$/.test(p))p="+"+p;
  if(/^0[17]\d{8}$/.test(p))p="+254"+p.slice(1);
  return p;
}

const hash=p=>crypto.scryptSync(clean(p),process.env.PASSWORD_SALT||"jr-pheef-v2",32).toString("hex");
const sha=p=>crypto.createHash("sha256").update(clean(p)).digest("hex");
const shaSalt=p=>crypto.createHash("sha256").update(clean(p)+(process.env.PASSWORD_SALT||"jr-pheef-v2")).digest("hex");

async function passOK(p,h){
  if(!h)return false;
  if(h===hash(p)||h===sha(p)||h===shaSalt(p))return true;
  if(/^\$2[aby]\$\d\d\$/.test(h)){
    try{return await bcrypt.compare(clean(p),h)}catch{}
  }
  return false;
}

async function member(v){
  if(!db)return null;
  const p=phone(v);
  for(const x of [p,p.replace("+254","0"),p.replace("+","")]){
    const r=await db.from("members").select("*").eq("phone",x).limit(1);
    if(r.data?.[0])return r.data[0];
  }
  return null;
}

async function send(to,msg){
  if(!tw||!FROM)throw Error("TWILIO_NOT_CONFIGURED");
  return tw.messages.create({
    from:FROM,
    to:`whatsapp:${phone(to)}`,
    body:msg
  });
}

const twiml=x=>`<Response><Message>${esc(x)}</Message></Response>`;

function page(title,body){
 return `<!doctype html><html><head>
 <meta name="viewport" content="width=device-width,initial-scale=1">
 <title>${esc(title)}</title>
 <style>
 body{font-family:Arial;background:#f3f5f7;margin:0;padding:24px}
 main{max-width:520px;margin:auto;background:#fff;padding:24px;border-radius:18px;box-shadow:0 4px 20px #0001}
 input,button{width:100%;box-sizing:border-box;padding:13px;margin:7px 0;border:1px solid #ddd;border-radius:10px}
 button{background:#111;color:white;font-weight:bold}
 a{color:#111}
 </style></head><body><main>${body}</main></body></html>`;
}

/* HOME */

app.get("/",(q,r)=>r.send(page("JR PHEEF",`
<h1>JR PHEEF</h1>
<p><b>Find. Match. Trade.</b></p>
<p>One account. Find opportunities. Create opportunities. Connect.</p>
<a href="/login">Login</a> · <a href="/signup">Create account</a>
`)));

/* REGISTRATION */

app.get("/signup",(q,r)=>r.send(page("Create account",`
<h2>Create JR PHEEF account</h2>
<form method="post">
<input name="full_name" placeholder="Full name" required>
<input name="birth_year" placeholder="Birth year" inputmode="numeric">
<input name="phone" placeholder="07XXXXXXXX" required>
<input name="password" type="password" placeholder="Password" required>
<input name="confirm_password" type="password" placeholder="Confirm password" required>
<button>Create account</button>
</form>
<p><a href="/login">Already have an account?</a></p>
`)));

app.post("/signup",async(q,r)=>{
 try{
  if(!db)return r.send("Database not configured.");
  const b=q.body,p=phone(b.phone);

  if(clean(b.password)!==clean(b.confirm_password))
   return r.send(page("Error","<h3>Passwords do not match.</h3><a href=/signup>Try again</a>"));

  if(await member(p))
   return r.send(page("Account exists",
   "<h3>This phone is already registered.</h3><a href=/login>Login</a> · <a href=/forgot>Reset password</a>"));

  const c=await db.from("members").select("id",{count:"exact",head:true});
  const dgbo=`DGBO-${String((c.count||0)+1).padStart(6,"0")}`;

  const x=await db.from("members").insert([{
   full_name:clean(b.full_name),
   birth_year:clean(b.birth_year)||null,
   phone:p,
   password_hash:hash(b.password),
   dgbo_id:dgbo,
   verified:false,
   status:"active",
   plan:"free",
   rewards:0,
   credits:0,
   referrals:0,
   account_type:"individual"
  }]).select().single();

  if(x.error)throw x.error;

  r.send(page("Welcome",`
   <h2>✅ Account created</h2>
   <p>Welcome ${esc(b.full_name)}.</p>
   <p>Your DGBO ID:</p>
   <h2>${esc(dgbo)}</h2>
   <a href="/login">Login now</a>
  `));
 }catch(e){
  console.error("SIGNUP",e);
  r.status(500).send("Registration error. Check Render logs.");
 }
});

/* LOGIN */

app.get("/login",(q,r)=>r.send(page("Login",`
<h2>Login to JR PHEEF</h2>
<form method="post">
<input name="phone" placeholder="07XXXXXXXX or +254..." required>
<input name="password" type="password" placeholder="Password" required>
<button>Login</button>
</form>
<p><a href="/forgot">Forgot password?</a></p>
`)));

app.post("/login",async(q,r)=>{
 try{
  const u=await member(q.body.phone);

  if(!u)
   return r.send(page("Login failed",
   "<h3>Account not found.</h3><a href=/signup>Create account</a>"));

  if(String(u.status||"active").toLowerCase()!=="active")
   return r.send("This account is not active.");

  const ok=await passOK(q.body.password,u.password_hash);

  if(!ok)
   return r.send(page("Login failed",
   "<h3>Password is incorrect.</h3><a href=/forgot>Reset password</a>"));

  /* Upgrade EVERY legacy password after successful login */
  const nh=hash(q.body.password);
  if(u.password_hash!==nh)
   await db.from("members").update({password_hash:nh}).eq("id",u.id);

  r.redirect(`/home?id=${encodeURIComponent(u.id)}`);
 }catch(e){
  console.error("LOGIN",e);
  r.status(500).send("Login error. Check Render logs.");
 }
});

/* FORGOT PASSWORD */

app.get("/forgot",(q,r)=>r.send(page("Forgot password",`
<h2>Reset password</h2>
<p>Enter the phone number registered with JR PHEEF.</p>
<p>Your OTP will be sent to you by WhatsApp.</p>
<form method="post">
<input name="phone" placeholder="07XXXXXXXX" required>
<button>Send OTP</button>
</form>
<p><a href="/login">Back to login</a></p>
`)));

app.post("/forgot",async(q,r)=>{
 try{
  const p=phone(q.body.phone),u=await member(p);

  if(!u)
   return r.send(page("Reset",
   "<h3>If that account exists, an OTP has been sent.</h3><a href=/login>Back</a>"));

  const code=String(crypto.randomInt(100000,1000000));
  const expires=new Date(Date.now()+10*60*1000).toISOString();

  /* Invalidate old codes */
  await db.from("password_resets")
   .update({used:true})
   .eq("phone",p)
   .eq("used",false);

  const x=await db.from("password_resets").insert([{
   phone:p,
   code_hash:hash(code),
   expires_at:expires,
   used:false
  }]);

  if(x.error)throw x.error;

  await send(p,`🔐 JR PHEEF PASSWORD RESET

Your OTP is: ${code}

Valid for 10 minutes.

Do not share this code with anyone.`);

  /* THIS is the missing bridge */
  r.redirect(`/reset?phone=${encodeURIComponent(p)}`);

 }catch(e){
  console.error("FORGOT",e);
  r.status(500).send(`
   OTP could not be sent.
   <br><br>
   Check Twilio configuration and password_resets table.
  `);
 }
});

/* RESET PAGE */

app.get("/reset",(q,r)=>{
 const p=phone(q.query.phone);

 r.send(page("Reset password",`
 <h2>🔐 Reset your password</h2>
 <p>OTP sent to:</p>
 <b>${esc(p)}</b>

 <form method="post">
 <input type="hidden" name="phone" value="${esc(p)}">

 <input name="code"
  placeholder="6-digit OTP"
  inputmode="numeric"
  maxlength="6"
  required>

 <input name="password"
  type="password"
  placeholder="New password"
  required>

 <input name="confirm_password"
  type="password"
  placeholder="Confirm new password"
  required>

 <button>Reset Password</button>
 </form>

 <p><a href="/forgot">Request another OTP</a></p>
 `));
});

/* RESET PASSWORD */

app.post("/reset",async(q,r)=>{
 try{
  const p=phone(q.body.phone);

  if(clean(q.body.password)!==clean(q.body.confirm_password))
   return r.send(page("Reset failed",
   "<h3>Passwords do not match.</h3><a href=/reset?phone="+encodeURIComponent(p)+">Try again</a>"));

  const x=await db.from("password_resets")
   .select("*")
   .eq("phone",p)
   .eq("used",false)
   .order("created_at",{ascending:false})
   .limit(1)
   .maybeSingle();

  const z=x.data;

  if(!z)
   return r.send(page("Reset failed",
   "<h3>No active reset request.</h3><a href=/forgot>Request OTP</a>"));

  if(new Date(z.expires_at)<new Date())
   return r.send(page("Reset failed",
   "<h3>OTP expired.</h3><a href=/forgot>Request a new OTP</a>"));

  if(!(await passOK(q.body.code,z.code_hash)))
   return r.send(page("Reset failed",
   "<h3>Invalid OTP.</h3><a href=/reset?phone="+encodeURIComponent(p)+">Try again</a>"));

  const u=await member(p);

  if(!u)return r.send("Account not found.");

  const a=await db.from("members")
   .update({password_hash:hash(q.body.password)})
   .eq("id",u.id);

  if(a.error)throw a.error;

  await db.from("password_resets")
   .update({used:true})
   .eq("id",z.id);

  r.send(page("Password changed",`
   <h2>✅ Password changed</h2>
   <p>Your JR PHEEF password has been successfully reset.</p>
   <a href="/login">Login now</a>
  `));

 }catch(e){
  console.error("RESET",e);
  r.status(500).send("Password reset error. Check Render logs.");
 }
});

/* ACCESS MODEL */

function freeWindow(){
 const h=Number(new Intl.DateTimeFormat("en-KE",{
  timeZone:"Africa/Nairobi",
  hour:"2-digit",
  hour12:false
 }).format(new Date()));
 return h>=2&&h<6;
}

async function activePass(p){
 if(!db)return false;

 const x=await db.from("access_passes")
  .select("*")
  .eq("phone",p)
  .eq("status","active")
  .gt("expires_at",new Date().toISOString())
  .order("expires_at",{ascending:false})
  .limit(1);

 return !!x.data?.[0];
}

async function canUse(p){
 return freeWindow()||await activePass(p);
}

app.post("/access",async(q,r)=>{
 try{
  const p=phone(q.body.phone);

  if(freeWindow())
   return r.send(page("JR PHEEF",`
    <h2>🟢 FREE ACCESS</h2>
    <p>Everything is free right now.</p>
    <p>Free period: <b>2:00 AM – 6:00 AM EAT</b></p>
    <a href="/home?id=${encodeURIComponent((await member(p)).id)}">Continue</a>
   `));

  const u=await member(p);
  if(!u)return r.send("Member not found.");

  const existing=await db.from("access_passes")
   .select("*")
   .eq("phone",p)
   .eq("status","pending")
   .limit(1);

  if(!existing.data?.length){
   const x=await db.from("access_passes").insert([{
    member_id:String(u.id),
    phone:p,
    amount:PASS_FEE,
    hours:PASS_HOURS,
    status:"pending"
   }]);

   if(x.error)throw x.error;
  }

  r.send(page("Activate access",`
   <h2>🔐 Activate JR PHEEF</h2>
   <p><b>KSh ${PASS_FEE}</b> gives you <b>${PASS_HOURS} hours</b> of marketplace access.</p>
   <p>Pay to JR PHEEF Till:</p>
   <h2>${TILL}</h2>
   <p><b>Current status: PAYMENT PENDING</b></p>
   <p>Automatic activation will happen when the M-Pesa payment callback is connected.</p>
   <p>🕑 From 2:00 AM–6:00 AM EAT, everything is free.</p>
   <a href="/home?id=${encodeURIComponent(u.id)}">Back to JR PHEEF</a>
  `));

 }catch(e){
  console.error("ACCESS",e);
  r.status(500).send("Access error. Check Render logs.");
 }
});

/* MEMBER HOME */

app.get("/home",async(q,r)=>{
 try{
  const u=await member(q.query.id);
  if(!u)return r.send("Member not found.");

  const free=freeWindow();
  const active=await activePass(u.phone);

  r.send(page("JR PHEEF",`
   <h1>JR PHEEF</h1>
   <p>Welcome, <b>${esc(u.full_name)}</b></p>

   <p>DGBO ID: <b>${esc(u.dgbo_id)}</b></p>

   <hr>

   <h3>FIND · CREATE · MATCH · CONNECT</h3>

   <p>
   ${free
    ?"🟢 Everything is FREE right now."
    :active
     ?"🟢 Marketplace access ACTIVE."
     :"🔒 Marketplace access requires KSh 30 / 5 hours."}
   </p>

   ${free||active
    ?"<button disabled>Marketplace Access Active</button>"
    :`<form method="post" action="/access">
      <input type="hidden" name="phone" value="${esc(u.phone)}">
      <button>Activate 5 Hours — KSh 30</button>
      </form>`}

   <hr>

   <p>🤝 Social/friendship connections: <b>FREE</b></p>
   <p>📣 Create marketplace opportunities: <b>FREE</b></p>
   <p>🔐 Deal Rooms protect contact details.</p>
   <p>🎁 Rewards · Referrals · Coupons</p>
   <p>🚚 JR PHEEF approved rider network</p>

   <hr>

   <a href="/login">Log out</a>
  `));

 }catch(e){
  console.error("HOME",e);
  r.status(500).send("Home error.");
 }
});

/* MARKETPLACE */

async function find(item,loc,budget){
 let q=db.from("jr_listings")
  .select("*")
  .eq("status","ACTIVE");

 if(item)q=q.ilike("item_name",`%${item}%`);
 if(loc)q=q.ilike("location",`%${loc}%`);
 if(budget)q=q.lte("price",budget);

 const x=await q.order("created_at",{ascending:false});

 if(x.error)console.error("FIND",x.error);

 return x.data||[];
}

async function roomFor(listing,buyer){
 if(listing.phone===buyer)return null;

 const old=await db.from("deal_rooms")
  .select("*")
  .eq("listing_id",listing.id)
  .eq("buyer_phone",buyer)
  .in("status",["negotiating","agreed","paid"])
  .order("created_at",{ascending:false})
  .limit(1);

 if(old.data?.[0])return old.data[0];

 const x=await db.from("deal_rooms").insert([{
  listing_id:listing.id,
  buyer_phone:buyer,
  seller_phone:listing.phone,
  status:"negotiating",
  buyer_paid:false,
  seller_paid:false,
  buyer_agreed:false,
  seller_agreed:false
 }]).select().single();

 if(x.error)console.error("ROOM",x.error);

 return x.data;
}

async function rooms(p){
 const x=await db.from("deal_rooms")
  .select("*,jr_listings(item_name,price,location,photos)")
  .or(`buyer_phone.eq.${p},seller_phone.eq.${p}`)
  .in("status",["negotiating","agreed","paid"])
  .order("created_at",{ascending:false});

 if(x.error)console.error("ROOMS",x.error);

 return x.data||[];
}

/* WHATSAPP */

app.post("/api/webhook/whatsapp",async(q,r)=>{
 try{
  const text=clean(q.body.Body);
  const p=phone(q.body.From);
  const u=await member(p);
  const up=text.toUpperCase();

  console.log("📩 JR PHEEF",p,text);

  if(!u)
   return r.type("text/xml").send(twiml(
    `🔐 Please create your JR PHEEF account first.\n\n${BASE}/signup`
   ));

  if(!text)
   return r.type("text/xml").send(twiml(
    "👋 Tell me naturally what you are looking for or what you have."
   ));

  /* FREE SOCIAL / GENERAL */
  if(/^(HI|HELLO|HEY|START|MENU)$/i.test(text))
   return r.type("text/xml").send(twiml(
    "👋 Welcome to JR PHEEF.\n\nTell me naturally what you need or what you have.\n\nYou can use English, Sheng or mix both."
   ));

  /* MARKETPLACE ACCESS */
  if(!await canUse(p))
   return r.type("text/xml").send(twiml(
    `🔒 JR PHEEF marketplace access is KSh ${PASS_FEE} for ${PASS_HOURS} hours.\n\n🕑 Free access: 2am–6am EAT.\n\nActivate at:\n${BASE}/home?id=${u.id}\n\n🤝 Social connection remains FREE.`
   ));

  /* DEAL ROOMS */
  const rs=await rooms(p);

  if(/^DEALS$/i.test(up)){
   if(!rs.length)
    return r.type("text/xml").send(twiml("📂 You have no active Deal Rooms."));

   return r.type("text/xml").send(twiml(
    rs.map((x,i)=>
     `${i+1}. ${x.jr_listings?.item_name||"Item"} — KSh ${money(x.jr_listings?.price)}\nReply CHAT ${i+1}`
    ).join("\n\n")
   ));
  }

  if(/^CHAT\b/i.test(text)){
   const n=text.match(/^CHAT\s*(\d+)?/i)?.[1];
   const room=n?rs[Number(n)-1]:rs[0];

   if(!room)
    return r.type("text/xml").send(twiml("🔐 You have no active Deal Room."));

   const msg=text.replace(/^CHAT\s*\d*/i,"").trim();

   if(!msg)
    return r.type("text/xml").send(twiml(
     `🔐 JR PHEEF DEAL ROOM\n\n${room.jr_listings?.item_name||"Item"}\n\n💬 Type your message normally.`
    ));

   const other=p===room.buyer_phone?room.seller_phone:room.buyer_phone;

   await db.from("messages").insert([{
    room_id:room.id,
    sender_phone:p,
    message:msg
   }]);

   try{
    await send(other,`💬 JR PHEEF DEAL ROOM\n\n${msg}\n\nReply CHAT to continue.`);
   }catch(e){
    console.error("CHAT SEND",e);
   }

   return r.type("text/xml").send(twiml(
    "☑ Message sent securely. Your contact details remain protected."
   ));
  }

  /* FIND */
  if(/^FIND\b/i.test(text)||/^(looking for|need|natafuta|natafut)\b/i.test(text)){
   const item=text.replace(/^(FIND|looking for|need|natafuta|natafut)\s*/i,"").split("\n")[0].trim();

   if(!item)
    return r.type("text/xml").send(twiml(
     "🔎 Tell me what you are looking for.\nExample: Natafuta Toyota Axio Nairobi."
    ));

   const matches=await find(item,"",null);
   const listing=matches.find(x=>x.phone!==p);

   if(!listing)
    return r.type("text/xml").send(twiml(
     "😔 I haven't found a matching opportunity yet. I'll keep looking."
    ));

   const room=await roomFor(listing,p);

   if(!room)
    return r.type("text/xml").send(twiml(
     "I found a match but could not create the secure Deal Room."
    ));

   try{
    await send(listing.phone,
     `🎉 JR PHEEF MATCH\n\n${listing.item_name}\n💰 KSh ${money(listing.price)}\n📍 ${listing.location}\n\n🔐 Secure Deal Room ready.\nReply CHAT.`
    );
   }catch(e){
    console.error("MATCH NOTICE",e);
   }

   return r.type("text/xml").send(twiml(
    `🎉 I found a match!\n\n${listing.item_name}\n💰 KSh ${money(listing.price)}\n📍 ${listing.location}\n\n🔐 Secure Deal Room created.\n\nReply CHAT to start talking.`
   ));
  }

  /* CREATE */
  if(/^OPPORTUNITY\b/i.test(text)||/\b(nauza|selling|i have)\b/i.test(text)){
   const l=text.split("\n").map(clean);
   const item=l[1]||"";
   const price=parseInt((l[2]||"").replace(/[^0-9]/g,""),10)||0;
   const loc=l[3]||"";

   if(!item||!price||!loc)
    return r.type("text/xml").send(twiml(
     "📣 Create an opportunity with:\n\nOPPORTUNITY\nItem\nPrice\nLocation\n\nThen send your photos."
    ));

   const x=await db.from("jr_listings").insert([{
    seller_name:u.full_name,
    phone:p,
    item_name:item,
    price,
    location:loc,
    status:"ACTIVE",
    photos:[]
   }]).select().single();

   if(x.error){
    console.error("LIST",x.error);
    return r.type("text/xml").send(twiml(
     "I couldn't save that opportunity."
    ));
   }

   return r.type("text/xml").send(twiml(
    `✅ Opportunity created.\n\n${item}\n💰 KSh ${money(price)}\n📍 ${loc}\n\nSend your photos together.`
   ));
  }

  /* NORMAL CONVERSATION INSIDE AN ACTIVE ROOM */
  if(rs[0]){
   const room=rs[0];
   const other=p===room.buyer_phone?room.seller_phone:room.buyer_phone;

   await db.from("messages").insert([{
    room_id:room.id,
    sender_phone:p,
    message:text
   }]);

   try{
    await send(other,`💬 JR PHEEF DEAL ROOM\n\n${text}`);
   }catch(e){
    console.error("NORMAL CHAT",e);
   }

   return r.type("text/xml").send(twiml(
    "☑️ Message sent through your secure Deal Room."
   ));
  }

  return r.type("text/xml").send(twiml(
   "Tell me naturally what you are looking for or what you have."
  ));

 }catch(e){
  console.error("🔥 WEBHOOK",e);
  return r.type("text/xml").send(twiml(
   "❌ JR PHEEF had a problem. Please try again."
  ));
 }
});

/* HEALTH CHECK */

app.get("/health",(q,r)=>r.json({
 ok:true,
 db:!!db,
 twilio:!!tw&&!!FROM,
 listings:"jr_listings",
 access:"KSh 30 / 5 hours",
 free_window:"02:00-06:00 EAT",
 password_reset:"database OTP"
}));

app.listen(PORT,()=>console.log(
 `🚀 JR PHEEF ${PORT} | DB ${db?"CONNECTED":"MISSING"} | jr_listings | PASSWORD RESET DB | KSh ${PASS_FEE}/${PASS_HOURS}h | FREE 02-06 EAT`
));
