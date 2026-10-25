const { CONFIG, CATEGORIES, NAV, PRODUCTS } = PresenceCatalog;


const $=s=>document.querySelector(s);
const brl=n=>n.toLocaleString("pt-BR",{style:"currency",currency:"BRL"});
// Normaliza o número: remove não dígitos, valida DDD+9 dígitos (celular BR) e prefixa 55.
function normPhone(raw){let d=String(raw).replace(/\D/g,"");if(d.startsWith("55")&&d.length>=12)d=d.slice(2);return /^[1-9]\d9\d{8}$/.test(d)?"55"+d:null}
const PHONE=normPhone(CONFIG.whatsappRaw);
const phoneFmt=PHONE?`(${PHONE.slice(2,4)}) ${PHONE.slice(4,9)}-${PHONE.slice(9)}`:"";
const wa=t=>PHONE?`https://wa.me/${PHONE}?text=${encodeURIComponent(t)}`:"#";
const P="Olá! Vim pelo site da Presence Papelaria e gostaria de ";
const ICONS={book:'<path d="M5 4h11a3 3 0 0 1 3 3v13H8a3 3 0 0 1-3-3z"/><path d="M5 17a3 3 0 0 1 3-3h11M10 8h5"/>',notebook:'<rect x="5" y="3" width="14" height="18" rx="2"/><path d="M9 3v18M12 8h4M12 12h4"/>',bookmark:'<path d="M7 3h10v18l-5-4-5 4z"/>',gift:'<rect x="4" y="9" width="16" height="11" rx="1"/><path d="M3 6h18v3H3zM12 6v14M12 6c-2-3-5-3-5-1s3 1 5 1zm0 0c2-3 5-3 5-1s-3 1-5 1z"/>',box:'<path d="M3 8l9-5 9 5v9l-9 5-9-5z"/><path d="M3 8l9 5 9-5M12 13v9"/>'};
const icon=k=>`<svg viewBox="0 0 24 24" aria-hidden="true">${ICONS[k]}</svg>`;
const catOf=id=>CATEGORIES.find(c=>c.id===id);
function readFavorites(value){try{const data=JSON.parse(value||'[]');return new Set(Array.isArray(data)?data.filter(id=>typeof id==='string'&&PRODUCTS.some(p=>p.id===id)):[])}catch(_){return new Set()}}
let favs=new Set();try{favs=readFavorites(localStorage.getItem("presence:favs"))}catch(e){}
const saveFavs=()=>{try{localStorage.setItem("presence:favs",JSON.stringify([...favs]))}catch(e){}};
const S={cat:"all",price:"all",pers:"all",sort:"rel",q:"",favOnly:false,onlyNew:false};
const norm=s=>s.normalize("NFD").replace(/[\u0300-\u036f]/g,"").toLowerCase();

const visualEscape=value=>String(value).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
function visual(p,{source=imgs(p)[0],id='',eager=false,thumbnail=false,index=0}={}){
  const name=visualEscape(p.name),status=source?'Fotografia indisponível':'Fotografia em breve';
  const fallback=thumbnail?'<span class="image-unavailable">Imagem indisponível</span>':`<span class="ph" role="img" aria-label="${name} — fotografia ainda não disponível"><span class="placeholder-index">P / ${String(PRODUCTS.indexOf(p)+1).padStart(2,"0")}</span><span class="placeholder-name">${name}</span><span class="placeholder-foot">Presence Papelaria<br><small>${status}</small></span></span>`;
  return `<span class="product-visual">${source?`<img ${id?`id="${id}"`:''} src="${visualEscape(source)}" alt="${thumbnail?'':name+(index?` — imagem ${index+1}`:'')}" loading="${eager?'eager':'lazy'}" decoding="async">`:''}<span class="image-fallback"${source?' hidden':''}>${fallback}</span></span>`;
}
// Image errors do not bubble. Capture them for cards, cart and gallery, including cached failures.
document.addEventListener('error',event=>{const image=event.target;if(!image.matches?.('.product-visual > img'))return;image.hidden=true;image.parentElement.querySelector('.image-fallback').hidden=false},true);
function list(){
  let a=PRODUCTS.filter(p=>(S.cat==="all"||(Array.isArray(S.cat)?S.cat.includes(p.cat):S.cat===p.cat))&&(S.price==="all"||(S.price==="priced")===(p.price!=null))&&(S.pers==="all"||(S.pers==="yes")===p.personalizable)&&(!S.favOnly||favs.has(p.id))&&(!S.onlyNew||p.isNew)&&(!S.q||norm(p.name+" "+catOf(p.cat).name+" "+p.desc+" "+(p.keywords||[]).join(" ")).includes(norm(S.q))));
  const byName=(x,y)=>x.name.localeCompare(y.name,"pt-BR");
  if(S.sort==="az")a.sort(byName);
  if(S.sort==="pa"||S.sort==="pd")a.sort((x,y)=>{if(x.price==null&&y.price==null)return byName(x,y);if(x.price==null)return 1;if(y.price==null)return -1;return S.sort==="pa"?x.price-y.price:y.price-x.price});
  return a}
function render(){
  const focused=document.activeElement,card=focused.closest?.('#grid [data-product]');
  const focusIndex=card?[...card.querySelectorAll('button,a,input,select')].indexOf(focused):-1;
  const a=list();$("#count").textContent=a.length+(a.length===1?" produto":" produtos");
  $("#grid").innerHTML=a.length?a.map(p=>`<article class="card" data-product="${p.id}"><div class="thumb"><button class="thumb" data-open="${p.id}" aria-label="Ver detalhes de ${p.name}">${visual(p)}</button><button class="fav" data-fav="${p.id}" aria-pressed="${favs.has(p.id)}" aria-label="Favoritar ${p.name}"><svg viewBox="0 0 24 24"><path d="M12 20s-7-4.4-9-9a5 5 0 0 1 9-3 5 5 0 0 1 9 3c-2 4.6-9 9-9 9z"/></svg></button>${p.personalizable?'<span class="tag">Personalizável</span>':""}</div><div class="info"><span class="cl">${catOf(p.cat).name}</span><h3><button data-open="${p.id}">${p.name}</button></h3>${priceHtml(p)}${p.available?`${PresenceCommerce.priceCents(p)!==null?`<button class="btn sm" type="button" ${p.variants?.length||p.personalizable?`data-open="${p.id}"`:`data-add-cart="${p.id}"`}>${p.variants?.length||p.personalizable?"Escolher opções":"Adicionar ao carrinho"}</button>`:`<a class="btn sm" target="_blank" rel="noopener" href="${wa(msg(p,1,""))}">Solicitar orçamento</a>`}`:'<span class="price q">Indisponível no momento</span>'}</div></article>`).join(""):`<div class="empty"><h3>Nenhum produto encontrado</h3><p>Tente outra palavra ou remova alguns filtros.</p><button class="btn sm" data-clear>Limpar filtros</button></div>`;
  document.querySelectorAll(".cat").forEach(b=>b.classList.toggle("on",b.dataset.cat===String(S.cat)));
  document.dispatchEvent(new Event("presence:render"));
  const n=favs.size;$("#favn").hidden=!n;$("#favn").textContent=n;$("#favview").setAttribute("aria-pressed",S.favOnly);
  if(focusIndex>=0){const replacement=document.querySelector(`#grid [data-product="${card.dataset.product}"]`);(replacement?.querySelectorAll('button,a,input,select')[focusIndex]||$('#favview')).focus({preventScroll:true})}}
const priceHtml=p=>p.price!=null?`<div class="price">${brl(p.price)}</div>`:`<div class="price q">${CONFIG.quoteLabel}</div>`;
function msg(p,q,note,v){
  const o=(q>1?` (quantidade: ${q})`:"")+(v?` — opção: ${v}`:"");
  const t=p.price==null?P+"solicitar um orçamento para "+p.name+o+".":P+"comprar "+p.name+o+` (${brl(p.price)}).`;
  return note?t+" Personalização desejada: "+note:t}
function setCat(v){S.cat=v;S.favOnly=false;S.onlyNew=false;$("#fcat").value=Array.isArray(v)?"grp:"+v.join(","):v;render()}
function init(){
  $("#ann").textContent=CONFIG.announcement;$("#yr").textContent=new Date().getFullYear();
  $("#igLink").href=$("#fig").href=$("#footer-instagram").href=CONFIG.instagram;
  if(PHONE){
    const contact = wa("Olá! Conheci a Presence Papelaria pelo site e gostaria de mais informações sobre os produtos.");
    $("#whatsapp-float").href = $("#footer-contact").href = contact;
    $("#whatsapp-float").hidden = false;$("#fwa").href=wa(P+"conhecer os produtos.");$("#fwa").textContent="WhatsApp "+phoneFmt;$("#quoteAll").href=wa(P+"solicitar um orçamento de presentes personalizados.")}
  else{$("#fwa").textContent=$("#footer-contact").textContent="WhatsApp indisponível";console.error("Número de WhatsApp inválido")}
  $("#ddm").innerHTML=CATEGORIES.map(c=>`<a href="#produtos" role="menuitem" data-cat="${c.id}">${c.name}</a>`).join("");
  const hasNew=PRODUCTS.some(p=>p.isNew);$("#nnew").hidden=!hasNew;
  $("#mnav").innerHTML='<a href="#produtos" data-go="all">Todos os produtos</a>'+(hasNew?'<a href="#produtos" data-new="1">Novidades</a>':"")+CATEGORIES.map(c=>`<a href="#produtos" data-cat="${c.id}">${c.name}</a>`).join("");
  $("#catrow").innerHTML=CATEGORIES.map(c=>`<button class="cat" data-cat="${c.id}">${icon(c.icon)}${c.name}</button>`).join("");
  $("#fcat").innerHTML='<option value="all">Categoria: todas</option>'+CATEGORIES.map(c=>`<option value="${c.id}">${c.name}</option>`).join("")+NAV.filter(n=>Array.isArray(n.go)).map(n=>`<option value="grp:${n.go.join(",")}" hidden>${n.label}</option>`).join("");
  const categoryLink = c => `<li><a href="#produtos" data-cat="${c.id}">${c.name}</a></li>`;
  $("#fcats").innerHTML='<li><a href="#produtos" data-go="all">Todos os produtos</a></li>'+CATEGORIES.slice(0,4).map(categoryLink).join("");
  $("#fgifts").innerHTML=CATEGORIES.slice(4).map(categoryLink).join("")+["caneca","necessaire","chaveiro"].map(id=>{const p=PRODUCTS.find(p=>p.id===id);return `<li><a href="#p-${id}">${p.name}</a></li>`}).join("");
  $("#plist").innerHTML=PRODUCTS.filter(p=>p.personalizable).map(p=>`<button data-open="${p.id}"><b>${p.name}</b><small>Ver detalhes e pedir orçamento</small></button>`).join("");
  render()}
document.addEventListener("click",e=>{
  const t=e.target.closest("[data-open],[data-fav],[data-cat],[data-nav],[data-clear],[data-go],[data-new]");if(!t)return;
  if(t.dataset.open){detailOrigins.set(t.dataset.open,{index:[...t.closest('[data-product]')?.querySelectorAll('[data-open]')||[]].indexOf(t)});location.hash="p-"+t.dataset.open;return}
  if(t.dataset.new){setCat("all");S.onlyNew=true;render();closeM();closeDD();return}
  if(t.dataset.fav){try{favs=readFavorites(localStorage.getItem('presence:favs'))}catch(_){}const id=t.dataset.fav;favs.has(id)?favs.delete(id):favs.add(id);saveFavs();render();return}
  if(t.dataset.cat){closeM();closeDD();setCat(t.dataset.cat);$("#produtos").scrollIntoView();return}
  if(t.dataset.go){closeM();closeDD();setCat("all");return}
  if(t.dataset.nav!==undefined){const n=NAV[t.dataset.nav];if(n.go==="home"){e.preventDefault();window.scrollTo(0,0)}else setCat(n.go==="all"?"all":n.go);closeM();return}
  if("clear" in t.dataset)clearAll()});
function clearAll(){Object.assign(S,{cat:"all",price:"all",pers:"all",sort:"rel",q:"",favOnly:false,onlyNew:false});["#fcat","#fprice","#fpers","#fsort"].forEach((s,i)=>$(s).value=["all","all","all","rel"][i]);$("#q").value=$("#mq").value="";render()}
$("#clear").onclick=clearAll;
$("#fcat").onchange=e=>{const v=e.target.value;S.cat=v.startsWith("grp:")?v.slice(4).split(","):v;render()};
$("#fprice").onchange=e=>{S.price=e.target.value;render()};
$("#fpers").onchange=e=>{S.pers=e.target.value;render()};
$("#fsort").onchange=e=>{S.sort=e.target.value;render()};
["#q","#mq"].forEach(s=>$(s).addEventListener("input",e=>{S.q=e.target.value;$("#q").value=$("#mq").value=S.q;render();if(S.q)$("#produtos").scrollIntoView()}));
$("#favview").onclick=()=>{S.favOnly=!S.favOnly;render()};
function closeM(restoreFocus=false){$("#mnav").classList.remove("open");$("#mnav").hidden=true;$("#burger").setAttribute("aria-expanded","false");if(restoreFocus)$('#burger').focus()}
$("#burger").onclick=()=>{const o=$("#burger").getAttribute('aria-expanded')!=='true';$("#mnav").classList.toggle('open',o);$("#mnav").hidden=!o;$("#burger").setAttribute("aria-expanded",o)};
document.addEventListener('keydown',e=>{if(e.key==='Escape'&&!document.querySelector('dialog[open]')&&$('#burger').getAttribute('aria-expanded')==='true'){e.preventDefault();closeM(true)}});
matchMedia('(max-width:1080px)').addEventListener('change',e=>{if(!e.matches){const inside=$('#mnav').contains(document.activeElement);closeM();if(inside)$('#ddb').focus()}});
addEventListener('storage',e=>{if(e.key==='presence:favs'||e.key===null){let value=e.newValue;try{value=localStorage.getItem('presence:favs')}catch(_){}const next=readFavorites(value);if(next.size===favs.size&&[...next].every(id=>favs.has(id)))return;favs=next;render()}});
const imgs=p=>{const images=Array.isArray(p.images)?p.images.filter(u=>typeof u==='string'&&u.trim()):[];return images.length?images:(typeof p.img==='string'&&p.img.trim()?[p.img]:[])};
let curP=null;
const detailOrigins=new Map();
function showP(p){
  curP=p;const c=catOf(p.cat),im=imgs(p),vs=p.variants||[],inf=p.info||[],q=p.price==null;
  const main=visual(p,{id:'gm',eager:true});
  const sent="Ao clicar, abrimos o WhatsApp com uma mensagem pronta com o produto"+(p.noQty?"":", a quantidade")+(vs.length?", a opção escolhida":"")+(p.personalizable?" e seu pedido de personalização":"")+". Você precisa enviar a mensagem. A loja confirmará disponibilidade, frete, valor final e instruções de pagamento na conversa. Abrir o WhatsApp não registra nem confirma um pedido.";
  $("#detail").innerHTML=`<div class="wrap"><nav class="crumb" aria-label="Você está em"><a href="#produtos" data-cat="all">Produtos</a> / <a href="#produtos" data-cat="${c.id}">${c.name}</a> / ${p.name}</nav>
<div class="dpage"><div class="gal"><div class="main">${main}</div>${im.length>1?`<p class="gallery-position" aria-live="polite">Imagem 1 de ${im.length}</p><div class="thumbs">${im.map((u,i)=>`<button type="button" data-th="${i}" aria-label="Ver imagem ${i+1} de ${visualEscape(p.name)}" aria-current="${i===0}">${visual(p,{source:u,thumbnail:true})}</button>`).join("")}</div>`:""}</div>
<div class="pi"><h1 id="pt" tabindex="-1">${p.name}</h1><p class="product-description">${p.desc}</p><hr class="sep">
<div class="big${q?" q":""}">${q?CONFIG.quoteLabel:brl(p.price)}</div>${q?'<p class="note">Preço a confirmar. Peça um orçamento pelo WhatsApp.</p>':""}
${vs.length?`<hr class="sep"><fieldset class="opts"><legend>${p.variantLabel||"Opção"}</legend>${vs.map((v,i)=>`<label><input type="radio" name="v" value="${v}"${i?"":" checked"}><span>${v}</span></label>`).join("")}</fieldset>`:""}
${p.noQty&&q?"":`<hr class="sep"><label class="lb" for="dq">Quantidade</label><div class="qty"><button type="button" data-q="-1" aria-label="Diminuir quantidade">−</button><input id="dq" type="number" min="1" max="99" value="1"><button type="button" data-q="1" aria-label="Aumentar quantidade">+</button></div>`}
${p.personalizable?`<hr class="sep"><label class="lb" for="dn">Personalização (opcional)</label><textarea id="dn" rows="3" maxlength="300" placeholder="Descreva o que deseja: nome, frase ou tema"></textarea><p class="note">As possibilidades serão confirmadas na conversa pelo WhatsApp.</p>`:""}
<hr class="sep">${p.available&&PresenceCommerce.priceCents(p)!==null?`<div class="detail-cart-actions"><button class="btn lg" id="detail-add-cart" type="button" data-add-cart="${p.id}">Adicionar ao carrinho</button></div><p class="note">Adicione ao carrinho para revisar vários produtos ou fale conosco sobre este item.</p>`:""}${p.available?`<a class="btn lg ghost" id="dgo" target="_blank" rel="noopener">${q?"Solicitar orçamento":"Consultar pelo WhatsApp"}</a><p class="note">${sent}</p>`:'<p class="price q">Indisponível no momento</p>'}
${inf.length?`<div class="product-accordions">${inf.map(i=>`<details class="acc"><summary>${i.title}</summary><p>${i.text}</p></details>`).join("")}</div>`:""}</div></div></div>`;
  upd()}
function upd(){const a=$("#dgo");if(!a||!curP)return;const q=$("#dq"),n=$("#dn"),v=document.querySelector("input[name=v]:checked");a.href=wa(msg(curP,q?Math.min(99,Math.max(1,parseInt(q.value)||1)):1,n?n.value.trim():"",v?v.value:""))}
$("#detail").addEventListener("click",e=>{const t=e.target.closest("[data-th],[data-q]");if(!t)return;
  if(t.dataset.th!==undefined){const index=Number(t.dataset.th);$('.gal .main').innerHTML=visual(curP,{source:imgs(curP)[index],id:'gm',eager:true,index});$('.gallery-position').textContent=`Imagem ${index+1} de ${imgs(curP).length}`;document.querySelectorAll(".thumbs button").forEach(b=>b.setAttribute("aria-current",b===t))}
  else{const q=$("#dq");q.value=Math.min(99,Math.max(1,(parseInt(q.value)||1)+parseInt(t.dataset.q)));upd()}});
$("#detail").addEventListener("input",upd);
const BASE=document.title;
function route(){const h=location.hash.slice(1),d=$("#detail"),m=$("#topo"),wasDetail=!d.hidden,p=h.startsWith("p-")&&PRODUCTS.find(x=>x.id===h.slice(2)),skip=$('.skip-link');
  if(p){showP(p);m.hidden=true;d.hidden=false;skip.href='#pt';skip.textContent='Ir para os detalhes do produto';document.title=p.name+" — Presence Papelaria";window.scrollTo(0,0);$("#pt").focus({preventScroll:true});return}
  d.hidden=true;m.hidden=false;skip.href='#produtos';skip.textContent='Ir para os produtos';document.title=BASE;const el=h&&document.getElementById(h);if(el)el.scrollIntoView();
  if(wasDetail){const previous=curP&&detailOrigins.get(curP.id);const origin=previous&&document.querySelector(`#grid [data-product="${curP.id}"]`);const opener=origin?.querySelectorAll('[data-open]')[previous.index];const target=(!h||h==='produtos')?(opener||$('#produtos')):(el?.getClientRects().length?el:$('#produtos'));if(!target.hasAttribute('tabindex')&&!target.matches('button,a,input,select,textarea'))target.tabIndex=-1;target.focus({preventScroll:true})}}
$('.skip-link').addEventListener('click',e=>{e.preventDefault();const target=$('#detail').hidden?$('#produtos'):$('#pt');target.focus({preventScroll:true});target.scrollIntoView()});
addEventListener("hashchange",route);
const dd=$("#ddb"),dm=$("#ddm");
function closeDD(){dm.classList.remove("open");dd.setAttribute("aria-expanded","false")}
function openDD(){dm.classList.add("open");dd.setAttribute("aria-expanded","true");dm.querySelector("a").focus()}
dd.onclick=()=>dm.classList.contains("open")?closeDD():openDD();
dd.addEventListener("keydown",e=>{if(e.key==="ArrowDown"){e.preventDefault();openDD()}});
dm.addEventListener("keydown",e=>{const a=[...dm.querySelectorAll("a")],i=a.indexOf(document.activeElement);
  if(e.key==="ArrowDown"){e.preventDefault();a[(i+1)%a.length].focus()}else if(e.key==="ArrowUp"){e.preventDefault();a[(i-1+a.length)%a.length].focus()}else if(e.key==="Escape"){closeDD();dd.focus()}});
document.querySelector(".dd").addEventListener("focusout",e=>{if(!e.currentTarget.contains(e.relatedTarget))closeDD()});
document.addEventListener("click",e=>{if(!e.target.closest(".dd"))closeDD()});
init();route();
