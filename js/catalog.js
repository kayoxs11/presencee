/* Shared owner-supplied catalog: browser storefront and local validation server. */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.PresenceCatalog = factory();
})(typeof globalThis !== 'undefined' ? globalThis : this, () => {
/* ===== CONFIGURAÇÃO EDITÁVEL (conteúdo do dono) ===== */
const CONFIG={
  announcement:"Produtos especiais para acompanhar sua jornada de fé",
  whatsappRaw:"8199438-2429",          // informado pelo dono: DDD 81 + 99438-2429
  instagram:"https://www.instagram.com/presence.papelaria?rpxt=a3pjemt0NmRuc3ox",
  quoteLabel:"Consulte o preço"
};
/* Opcionais por produto: images:["url",...] (galeria), variants:["Azul",...] + variantLabel:"Cor", info:[{title,text}] (só exibidos se preenchidos), keywords:[...], isNew:true (ativa "Novidades"). */
/* price: número (R$) ou null = preço a confirmar. img: URL/data URI da foto oficial ("" = ilustração provisória).
   personalizable: true abre campo de personalização. available: false mostra "Indisponível". */
const CATEGORIES=[
 {id:"biblias",name:"Bíblias e reforma",icon:"book"},
 {id:"devocionais",name:"Devocionais",icon:"book"},
 {id:"cadernos",name:"Cadernos e blocos",icon:"notebook"},
 {id:"marcadores",name:"Marcadores de página",icon:"bookmark"},
 {id:"personalizados",name:"Presentes personalizados",icon:"gift"},
 {id:"promessas",name:"Caixinha de promessas",icon:"box"}];
const NAV=[{label:"Home",go:"home"},{label:"Todos os produtos",go:"all"},{label:"Bíblias e devocionais",go:["biblias","devocionais"]},{label:"Papelaria",go:["cadernos","marcadores"]},{label:"Presentes personalizados",go:["personalizados","promessas"]}];
/* shipping: null means not supplied. Configure actual measured per-unit shipping
   weight (grams), dimensions (cm), and eligibility. Never guess measurements.
   Multi-item outer packaging is configured in shipping-config.js. */
// is_combo: true only for owner-confirmed combos/kits; never infer from names.
const PRODUCTS=[
 {id:"biblia",is_combo:false,shipping:{eligible:null,weightGrams:null,lengthCm:null,widthCm:null,heightCm:null},name:"Bíblia",cat:"biblias",price:60,img:"",desc:"Bíblia para leitura e estudo no dia a dia.",personalizable:false,available:true},
 {id:"reforma",is_combo:false,shipping:{eligible:null,weightGrams:null,lengthCm:null,widthCm:null,heightCm:null},name:"Reforma de Bíblia",cat:"biblias",price:70,noQty:true,img:"",desc:"Serviço de reforma para a sua Bíblia.",personalizable:false,available:true},
 {id:"devocional",is_combo:false,shipping:{eligible:null,weightGrams:null,lengthCm:null,widthCm:null,heightCm:null},name:"Devocional",cat:"devocionais",price:45,img:"",desc:"Devocional para acompanhar seus momentos com Deus.",personalizable:false,available:true},
 {id:"colegial",is_combo:false,shipping:{eligible:null,weightGrams:null,lengthCm:null,widthCm:null,heightCm:null},name:"Caderno colegial",cat:"cadernos",price:null,img:"",desc:"Caderno no formato colegial.",personalizable:false,available:true},
 {id:"a5",is_combo:false,shipping:{eligible:null,weightGrams:null,lengthCm:null,widthCm:null,heightCm:null},name:"Caderno A5",cat:"cadernos",price:null,img:"",desc:"Caderno no formato A5.",personalizable:false,available:true},
 {id:"a6",is_combo:false,shipping:{eligible:null,weightGrams:null,lengthCm:null,widthCm:null,heightCm:null},name:"Caderno A6",cat:"cadernos",price:null,img:"",desc:"Caderno no formato A6.",personalizable:false,available:true},
 {id:"moleskine",is_combo:false,shipping:{eligible:null,weightGrams:null,lengthCm:null,widthCm:null,heightCm:null},name:"Moleskine",cat:"cadernos",price:null,img:"",desc:"Caderno estilo Moleskine.",personalizable:false,available:true},
 {id:"bloco7",is_combo:false,shipping:{eligible:null,weightGrams:null,lengthCm:null,widthCm:null,heightCm:null},name:"Bloco de notas A7",cat:"cadernos",price:null,img:"",desc:"Bloco de notas no formato A7.",personalizable:false,available:true},
 {id:"bloco6",is_combo:false,shipping:{eligible:null,weightGrams:null,lengthCm:null,widthCm:null,heightCm:null},name:"Bloco de notas A6",cat:"cadernos",price:null,img:"",desc:"Bloco de notas no formato A6.",personalizable:false,available:true},
 {id:"marcador",is_combo:false,shipping:{eligible:null,weightGrams:null,lengthCm:null,widthCm:null,heightCm:null},name:"Marcadores de página",cat:"marcadores",price:null,img:"",desc:"Marcadores para suas leituras.",personalizable:false,available:true},
 {id:"marcadorm",is_combo:false,shipping:{eligible:null,weightGrams:null,lengthCm:null,widthCm:null,heightCm:null},name:"Marcadores de página magnéticos",cat:"marcadores",price:null,img:"",desc:"Marcadores de página magnéticos.",personalizable:false,available:true},
 {id:"necessaire",is_combo:false,shipping:{eligible:null,weightGrams:null,lengthCm:null,widthCm:null,heightCm:null},name:"Nécessaire personalizada",cat:"personalizados",price:null,img:"",desc:"Nécessaire personalizada.",personalizable:true,available:true},
 {id:"caneca",is_combo:false,shipping:{eligible:null,weightGrams:null,lengthCm:null,widthCm:null,heightCm:null},name:"Caneca personalizada",cat:"personalizados",price:null,img:"",desc:"Caneca personalizada.",personalizable:true,available:true},
 {id:"promessas",is_combo:false,shipping:{eligible:null,weightGrams:null,lengthCm:null,widthCm:null,heightCm:null},name:"Caixinha de promessas",cat:"promessas",price:null,img:"",desc:"Caixinha de promessas para presentear.",personalizable:false,available:true},
 {id:"chaveiro",is_combo:false,shipping:{eligible:null,weightGrams:null,lengthCm:null,widthCm:null,heightCm:null},name:"Chaveiro personalizado",cat:"personalizados",price:null,img:"",desc:"Chaveiro personalizado.",personalizable:true,available:true},
 {id:"album",is_combo:false,shipping:{eligible:null,weightGrams:null,lengthCm:null,widthCm:null,heightCm:null},name:"Álbum de fotos",cat:"personalizados",price:null,img:"",desc:"Álbum de fotos para guardar memórias.",personalizable:true,available:true}];
/* ===== FIM DA CONFIGURAÇÃO ===== */
return { CONFIG, CATEGORIES, NAV, PRODUCTS };
});
