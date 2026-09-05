const express=require("express"),crypto=require("crypto"),{createClient}=require("@supabase/supabase-js"),twilio=require("twilio");
const app=express(),PORT=process.env.PORT||10000,BASE=process.env.BASE_URL||"https://jr-pheef-marketplace.onrender.com";
const KEY=process.env.SUPABASE_SECRET_KEY||process.env.SUPABASE_SERVICE_ROLE_KEY||process.env.SUPABASE_ANON_KEY;
const db=process.env.SUPABASE_URL&&KEY?createClient(process.env.SUPABASE_URL,KEY):null;
const wa=process.env.TWILIO_ACCOUNT_SID&&process.env.TWILIO_AUTH_TOKEN?twilio(process.env.TWILIO_ACCOUNT_SID,process.env.TWILIO_AUTH_TOKEN):null,FROM=process.env.TWILIO_WHATSAPP_NUMBER;
app.use(express.urlencoded({extended:true}));app.use(express.json());

const clean=x=>String(x||"").trim();
const phone=x=>clean(x).replace(/^whatsapp:/i,"").replace(/[\s().-]/g,"").replace(/^0(7|1)/,"+254$1");
const esc=x=>clean(x).replace(/[&<>"']/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&apos;"}[c]));
const money=x=>Number(x||0).toLocaleString("en-KE");
const hash=p=>crypto.scryptSync(clean(p),process.env.PASSWORD_SALT||"jr-pheef-salt",32).toString("hex");
const block=/(\+?\d[\d\s().-]{7,}|\b\d{9,13}\b|https?:\/\/|www\.|\.com\b|\.co\.ke\b|@\w+\.\w+|\bwhatsapp\b|\btelegram\b|\bemail\b)/i;
const xml=x=>`<Response><Message>${esc(x)}</Message></Response>`;
const send=(to,body)=>wa&&FROM?wa.messages.create({from:FROM,to:`whatsapp:${phone(to)}`,body}):null;

// In-memory store for password reset codes: phone -> {code, expires}
const resetCodes=new Map();
const genCode=()=>String(Math.floor(100000+Math.random()*900000));
function cleanupCodes(){let now=Date.now();for(let[k,v]of resetCodes)if(v.expires<now)resetCodes.delete(k)}

async function member(p){
 if(!db)return null;
 let q=phone(p),{data}=await db.from("members").select("*").eq("phone",q).maybeSingle();
 if(!data&&q.startsWith("+254"))data=(await db.from("members").select("*").eq("phone","0"+q.slice(4)).maybeSingle()).data;
 return data;
}
async function dgbo(){
 let{count}=await db.from("members").select("id",{count:"exact",head:true});
 return`DGBO-${String((count||0)+1).padStart(6,"0")}`;
}
async function find(item,loc,budget){
 let q=db.from("jr_listings").select("*").eq("status","ACTIVE");
 if(item)q=q.ilike("item_name",`%${item}%`);
 if(loc)q=q.ilike("location",`%${loc}%`);
 if(budget)q=q.lte("price",budget);
 let{data,error}=await q.order("created_at",{ascending:false});
 if(error)console.error("FIND",error);
 return data||[];
}
async function rooms(p){
 let{data,error}=await db.from("deal_rooms").select("*,jr_listings(item_name,price,location,photos)")
 .or(`buyer_phone.eq.${p},seller_phone.eq.${p}`)
 .in("status",["negotiating","agreed","paid"]).order("created_at",{ascending:false});
 if(error)console.error("ROOMS",error);
 return data||[];
}
async function makeRoom(l,p){
 if(phone(l.phone)===phone(p))return null;
 let old=await db.from("deal_rooms").select("*").eq("listing_id",l.id).eq("buyer_phone",phone(p))
 .in("status",["negotiating","agreed","paid"]).limit(1);
 if(old.data?.[0])return old.data[0];
 let{data,error}=await db.from("deal_rooms").insert({
  listing_id:l.id,buyer_phone:phone(p),seller_phone:phone(l.phone),
  status:"negotiating",buyer_paid:false,seller_paid:false,
  buyer_agreed:false,seller_agreed:false
 }).select().single();
 if(error)console.error("ROOM",error);
 return data;
}

function page(title,body){
 return`<!doctype html><html><meta name=viewport content="width=device-width,initial-scale=1">
 <title>${esc(title)}</title><style>
 body{font-family:Arial;margin:0;background:#f4f8f5}header{background:#08783c;color:white;padding:22px}
 main{max-width:850px;margin:auto;padding:15px}.card{background:white;padding:18px;margin:12px 0;border-radius:16px;box-shadow:0 2px 10px #0001}
 input,textarea{width:100%;padding:12px;margin:5px 0;box-sizing:border-box;border:1px solid #ccc;border-radius:9px}
 button,.btn{background:#08783c;color:white;border:0;border-radius:9px;padding:11px 15px;text-decoration:none;display:inline-block;margin:3px}
 </style><body>${body}</body></html>`;
}

app.get("/",(_,r)=>r.send(page("JR PHEEF",`
<header><h1>JR PHEEF</h1><p>Find. Match. Trade.</p></header><main>
<div class=card><h2>Welcome</h2><p>Find opportunities, create opportunities, match and connect.</p>
<a class=btn href=/register>Create account</a><a class=btn href=/login>Sign in</a></div></main>`)));

app.get("/register",(_,r)=>r.send(page("Register",`<main><div class=card><h2>Create account</h2>
<form method=post><input name=full_name placeholder="Full name" required>
<input name=phone placeholder="07XXXXXXXX" required><input name=birth_year type=number placeholder="Birth year" required>
<input id=p name=password type=password placeholder="Password" required>
<label><input type=checkbox onclick="p.type=this.checked?'text':'password'"> Show password</label>
<button>Create account</button></form></div></main>`)));ctive Deal Rooms.";
 r.send(page("Deal Rooms",`<main><div class=card><h2>🔐 Deal Rooms</h2>${cards}</div></main>`));
});

app.post("/message",async(req,r)=>{
 try{
  if(block.test(req.body.message))return r.send("For safety, JR PHEEF does not allow phone numbers, links, email or external contact details.");
  let{data:room}=await db.from("deal_rooms").select("*").eq("id",req.body.room_id).single(),p=phone(req.body.phone);
  if(!room||![phone(room.buyer_phone),phone(room.seller_phone)].includes(p))return r.send("Not authorised");
  await db.from("messages").insert({room_id:room.id,sender_phone:p,message:clean(req.body.message)});
  let to=p===phone(room.buyer_phone)?room.seller_phone:room.buyer_phone;
  try{await send(to,`💬 JR PHEEF Deal Room\n\n${clean(req.body.message)}`)}catch(e){console.error("SEND",e)}
  r.redirect(`/deals?id=${encodeURIComponent(req.body.member)}`);
 }catch(e){console.error(e);r.status(500).send("Message error")}
});

app.get("/wallet",async(req,r)=>{
 let{data:u}=await db.from("members").select("*").eq("id",req.query.id).maybeSingle();
 r.send(page("Wallet",`<main><div class=card><h2>JR PHEEF Wallet</h2>
 Rewards: KSh ${money(u?.rewards)}<br>Credits: KSh ${money(u?.credits)}<br>
 Referrals: ${money(u?.referrals)}<br><br>Minimum individual withdrawal: KSh 200.</div></main>`));
});

app.post("/api/webhook/whatsapp",async(req,r)=>{
 try{
  let p=phone(req.body.From),text=clean(req.body.Body),u=await member(p),up=text.toUpperCase();
  if(!u)return r.type("text/xml").send(xml(`👋 Karibu JR PHEEF!\n\nCreate your account:\n${BASE}/register`));
  if(!text)return r.type("text/xml").send(xml(`👋 ${u.full_name}, tell me naturally what you need or what you have.`));

  if(up==="DEALS"){
   let rs=await rooms(p);
   return r.type("text/xml").send(xml(rs.length?`🔐 You have ${rs.length} active Deal Room(s).\n\nType CHAT to continue.`:"No active Deal Rooms yet."));
  }

  if(up==="CHAT"){
   let rs=await rooms(p),x=rs[0],l=x?.jr_listings||{};
   return r.type("text/xml").send(xml(x?`🔐 DEAL ROOM\n\n${l.item_name||"Opportunity"}\nKSh ${money(l.price)}\n📍 ${l.location||""}\n\nType your message normally.`:"No active Deal Room yet."));
  }

  if(/^FIND\b/i.test(text)){
   let a=text.split(/\n/).map(clean),m=await find(a[1],a[2],parseInt((a[3]||"").replace(/\D/g,""))||null);
   let l=m.find(x=>phone(x.phone)!==p);
   if(!l)return r.type("text/xml").send(xml("😔 I have not found a match yet. I will keep looking."));
   let room=await makeRoom(l,p);
   if(!room)return r.type("text/xml").send(xml("I could not create the secure Deal Room."));
   try{await send(l.phone,`🎉 JR PHEEF MATCH FOUND!\n\n${l.item_name}\nKSh ${money(l.price)}\n📍 ${l.location}\n\n🔐 Secure Deal Room created.`)}catch(e){console.error("NOTICE",e)}
   return r.type("text/xml").send(xml(`🎉 Match found!\n\n${l.item_name}\nKSh ${money(l.price)}\n📍 ${l.location}\n\n🔐 Secure Deal Room created.\n\nType CHAT to continue.`));
  }

  if(/^OPPORTUNITY\b/i.test(text)){
   let a=text.split(/\n/).map(clean),item=a[1],price=parseInt((a[2]||"").replace(/\D/g,"")),loc=a[3];
   if(!item||!price||!loc)return r.type("text/xml").send(xml("Send: OPPORTUNITY\nItem\nPrice\nLocation"));
   let{error}=await db.from("jr_listings").insert({
    seller_name:u.full_name,phone:p,item_name:item,price,location:loc,
    description:a.slice(4).join(" "),photos:[],status:"ACTIVE"
   });
   if(error)throw error;
   return r.type("text/xml").send(xml("✅ Opportunity listed. Send your photos and JR PHEEF will look for matches."));
  }

  return r.type("text/xml").send(xml(`👋 ${u.full_name}, I understand English, Sheng or a mix.\n\nTell me naturally what you are looking for or what you want to create.`));
 }catch(e){
  console.error("WEBHOOK",e);
  return r.type("text/xml").send(xml("JR PHEEF is temporarily unavailable. Please try again."));
 }
});

app.get("/health",(_,r)=>r.json({
 ok:true,db:!!db,whatsapp:!!wa,listings:"jr_listings",
 access:"KSh 30 / 5 hours",free_window:"02:00-06:00 EAT"
}));

app.listen(PORT,()=>console.log(
`🚀 JR PHEEF running on ${PORT} | DB ${db?"CONNECTED":"NOT CONNECTED"} | LISTINGS jr_listings | ACCESS KSh30/5h | FREE 02:00-06:00 EAT`
));
