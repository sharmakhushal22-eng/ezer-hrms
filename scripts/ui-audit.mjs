// Contrast + stuck-surface audit. Two distinct failure modes:
//   1. text that does not meet WCAG AA against what is behind it
//   2. a LIGHT background still rendering while the theme is dark, which is
//      what produces light-grey text on a white card
export const AUDIT = `(()=>{
 const lin=c=>{c/=255;return c<=0.03928?c/12.92:Math.pow((c+0.055)/1.055,2.4)};
 const lum=([r,g,b])=>0.2126*lin(r)+0.7152*lin(g)+0.0722*lin(b);
 const rgbs=s=>[...(s||'').matchAll(/rgba?\\(\\s*([\\d.]+)[,\\s]+([\\d.]+)[,\\s]+([\\d.]+)(?:[,\\s\\/]+([\\d.%]+))?/g)]
   .map(m=>[+m[1],+m[2],+m[3], m[4]===undefined?1:(String(m[4]).endsWith('%')?parseFloat(m[4])/100:+m[4])]);
 const over=(fg,bg)=>{const a=fg[3]; return [0,1,2].map(i=>fg[i]*a+bg[i]*(1-a))};
 // Composite every translucent layer down to an opaque colour, so a 15%-white
 // overlay on blue is not mistaken for white.
 const bgOf=el=>{const stack=[]; let n=el;
   while(n&&n!==document.documentElement){const cs=getComputedStyle(n);
     if(cs.backgroundImage&&cs.backgroundImage!=='none'){const g=rgbs(cs.backgroundImage); if(g.length){stack.push([...g[0].slice(0,3),1]); break}}
     const c=rgbs(cs.backgroundColor)[0];
     if(c&&c[3]>0){stack.push(c); if(c[3]>=0.999) break}
     n=n.parentElement}
   let base=[255,255,255];
   for(let i=stack.length-1;i>=0;i--) base=over(stack[i],base);
   return base};
 const dark=document.documentElement.getAttribute('data-ez-theme')==='dark'
   || (!document.documentElement.getAttribute('data-ez-theme') && matchMedia('(prefers-color-scheme: dark)').matches);
 const low=[], stuck=new Map();
 document.querySelectorAll('main *, nav *').forEach(el=>{
   if(el.closest('[data-nextjs-toast],nextjs-portal')) return;
   const cs=getComputedStyle(el);
   if(cs.visibility==='hidden'||cs.display==='none') return;
   const own=rgbs(cs.backgroundColor)[0];
   // Only flag real SURFACES. A badge, a progress bar or an avatar disc is
   // meant to be a light accent on a dark page; a 600x200 white panel is not.
   const box=el.getBoundingClientRect();
   if(dark && own && own[3]>0.85 && lum(own)>0.55 && box.width>220 && box.height>60){
     const k=cs.backgroundColor;
     if(!stuck.has(k)) stuck.set(k,{bg:k,n:0,sample:(el.innerText||'').trim().slice(0,30)});
     stuck.get(k).n++;
   }
   const txt=[...el.childNodes].filter(n=>n.nodeType===3&&n.textContent.trim()).map(n=>n.textContent.trim()).join('');
   if(!txt||txt.length<2||parseFloat(cs.opacity)<0.5) return;
   const f=rgbs(cs.color)[0]; if(!f) return;
   const bg=bgOf(el), fg=f[3]<1?over(f,bg):f;
   const l1=lum(fg),l2=lum(bg),r=(Math.max(l1,l2)+0.05)/(Math.min(l1,l2)+0.05);
   const size=parseFloat(cs.fontSize),bold=parseInt(cs.fontWeight)>=700;
   if(r<((size>=24||(size>=18.66&&bold))?3:4.5))
     low.push({t:txt.slice(0,26),r:+r.toFixed(2),size:+size.toFixed(1),fg:cs.color,bg:'rgb('+bg.map(Math.round).join(',')+')'});
 });
 return {low, stuck:[...stuck.values()]}})()`
