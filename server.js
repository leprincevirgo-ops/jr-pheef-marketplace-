const express=require("express"),crypto=require("crypto"),{createClient}=require("@supabase/supabase-js"),twilio=require("twilio");
const app=express(),PORT=process.env.PORT||10000,BASE=process.env.BASE_URL||"https://jr-pheef-marketplace.onrender.com";
const KEY=process.env.SUPABASE_SECRET_KEY||process.env.SUPABASE_SERVICE_ROLE_KEY||process.env.SUPABASE_ANON_KEY;
const db=process.env.SUPABASE_URL&&KEY?createClient(process.env.SUPABASE_URL,KEY):null;
const wa=process.env.TWILIO_ACCOUNT_SID&&process.env.TWILIO_AUTH_TOKEN?twilio(process.env.TWILIO_ACCOUNT_SID,process.env.TWILIO_AUTH_TOKEN):null,FROM=process.env.TWILIO_WHATSAPP_NUMBER;
app.use(express.urlencoded({extended:true}));app.use(express.json());

const clean=x=>String(x||"").trim(),salt=()=>process.env.PASSWORD_SALT||"jr-pheef-salt";
const phone=x=>{let p=clean(x).replace(/^whatsapp:/i,"").replace(/[\s().-]/g,"");return /^0[17]\d{8}$/.test(p)?"+254"+p.slice(1):p};
const esc=x=>clean(x).replace(/[&<>"']/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]));
const money=x=>Number(x||0).toLocaleString("en-KE");
const hash=p=>crypto.scryptSync(clean(p),salt(),32).toString("hex");
const legacy=p=>crypto.createHash("sha256").update(clean(p)+salt()).digest("hex");
const block=/(\+?\d[\d\s().-]{7,}|\b\d{9,13}\b|https?:\/\/|www\.|\.com\b|\.co\.ke\b|@\w+\.\w+|\bwhatsapp\b|\btelegram\b|\bemail\b)/i;
const xml=x=>`<Response><Message>${esc(x)}</Message></Response>`;
async function send(to,body){if(!wa||!FROM)return null;return wa.messages.create({from:FROM,to:`whatsapp:${phone(to)}`,body})}

async function member(p){
 if(!db)return null;
 let q=phone(p),r=await db.from("members").select("*").eq("phone",q).maybeSingle();
 if(!r.data&&q.startsWith("+254"))r=await db.from("members").select("*").eq("phone","0"+q.slice(4)).maybeSingle();
 return r.data||null
}
function passOK(p,h){
 if(!h)return false;
 return h===hash(p)||h===legacy(p)||h===crypto.createHash("sha256").update(clean(p)).digest("hex")
}
async function rooms(p){
 let{data,error}=await db.from("deal_rooms").select("*,jr_listings(item_name,price,location,photos)")
 .or(`buyer_phone.eq.${p},seller_phone.eq.${p}`).in("status",["negotiating","agreed","paid"]).order("created_at",{ascending:false});
 if(error)console.error("ROOMS",error);return data||[]
}
async function find(item,loc,budget){
 let q=db.from("jr_listings").select("*").eq("status","ACTIVE");
 if(item)q=q.ilike("item_name",`%${item}%`);
 if(loc)q=q.ilike("location",`%${loc}%`);
 if(budget)q=q.lte("price",budget);
 let{data,error}=await q.order("created_at",{ascending:false});
 if(error)console.error("FIND",error);return data||[]
}
async function room(l,p){
 if(phone(l.phone)===phone(p))return null;
 let old=await db.from("deal_rooms").select("*").eq("listing_id",l.id).eq("buyer_phone",phone(p)).in("status",["negotiating","agreed","paid"]).limit(1);
 if(old.data?.[0])return old.data[0];
 let{data,error}=await db.from("deal_rooms").insert({listing_id:l.id,buyer_phone:phone(p),seller_phone:phone(l.phone),status:"negotiating",buyer_paid:false,seller_paid:false,buyer_agreed:false,seller_agreed:false}).select().single();
 if(error)console.error("ROOM",error);return data
}
function page(t,b){return`<!doctype html><html><meta name=viewport content="width=device-width,initial-scale=1"><title>${esc(t)}</title><style>body{font-family:Arial;background:#f4f8f5;margin:0}header{background:#08783c;color:#fff;padding:22px}main{max-width:850px;margin:auto;padding:15px}.card{background:#fff;padding:18px;margin:12px 0;border-radius:16px;box-shadow:0 2px 10px #0001}input,textarea{width:100%;padding:12px;margin:5px 0;box-sizing:border-box;border:1px solid #ccc;border-radius:9px}button,.btn{background:#08783c;color:#fff;border:0;border-radius:9px;padding:11px 15px;text-decoration:none;display:inline-block;margin:3px}</style><body>${b}</body></html>`}

app.get("/",(_,r)=>r.send(page("JR PHEEF",`<header><h1>JR PHEEF</h1><p>Find. Match. Trade.</p></header><main><div class=card><h2>Welcome</h2><p>Find opportunities, create opportunities, match and connect.</p><a class=btn href=/register>Create account</a><a class=btn href=/login>Sign in</a></div></main>`)));

app.get("/register",(_,r)=>r.send(page("Register",`<main><div class=card><h2>Create account</h2><form method=post><input name=full_name placeholder="Full name" required><input name=phone placeholder="07XXXXXXXX" required><input name=birth_year type=number placeholder="Birth year" required><input id=p name=password type=password placeholder="Password" required><input id=c name=confirm_password type=password placeholder="Confirm password" required><label><input type=checkbox onclick="p.type=this.checked?'text':'password';c.type=this.checked?'text':'password'"> Show passwords</label><button>Create account</button></form><a href=/login>Already have an account?</a></div></main>`)));

app.post("/register",async(req,r)=>{try{
 if(!db)return r.send("Database not connected");
 if(req.body.password!==req.body.confirm_password)return r.send("Passwords do not match. <a href=/register>Try again</a>");
 let p=phone(req.body.phone);if(await member(p))return r.send("Account already exists. <a href=/login>Sign in</a>");
 let{count}=await db.from("members").select("id",{count:"exact",head:true}),dgbo_id=`DGBO-${String((count||0)+1).padStart(6,"0")}`;
 let{data,error}=await db.from("members").insert({dgbo_id,full_name:clean(req.body.full_name),phone:p,birth_year:req.body.birth_year,password_hash:hash(req.body.password),reputation:0,rewards:0,credits:0,referrals:0,plan:"free",theme:"green",verified:false,status:"active",account_type:"individual"}).select().single();
 if(error)throw error;r.redirect(`/home?id=${data.id}`)
}catch(e){console.error("REGISTER",e);r.status(500).send("Registration error: "+esc(e.message))}});

app.get("/login",(_,r)=>r.send(page("Login",`<main><div class=card><h2>Sign in</h2><form method=post><input name=phone placeholder="Phone" required><input id=p name=password type=password placeholder="Password" required><label><input type=checkbox onclick="p.type=this.checked?'text':'password'"> Show password</label><button>Sign in</button></form><a href=/forgot>Forgot password?</a></div></main>`)));

app.post("/login",async(req,r)=>{try{
 let u=await member(req.body.phone);
 if(!u||!passOK(req.body.password,u.password_hash))return r.send("Incorrect phone or password. <a href=/login>Try again</a>");
 if(u.password_hash!==hash(req.body.password))await db.from("members").update({password_hash:hash(req.body.password)}).eq("id",u.id);
 r.redirect(`/home?id=${u.id}`)
}catch(e){console.error("LOGIN",e);r.status(500).send("Login error")}});

const reset=new Map();

app.get("/forgot",(_,r)=>r.send(page("Forgot password",`<main><div class=card><h2>Forgot password?</h2><p>Enter your registered phone and JR PHEEF will send a reset code on WhatsApp.</p><form method=post><input name=phone placeholder="07XXXXXXXX" required><button>Send reset code</button></form></div></main>`)));

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
