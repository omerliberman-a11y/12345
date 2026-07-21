import{AmpSanitizeError as p,componentScripts as r,AMP_LIGHTBOX_ID as y,AMP_RUNTIME_SRC as d}from"./ampSanitize-DdJs1fRM.js";const o=75*1024;function h(t){return t.replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;").replace(/"/g,"&quot;")}function $(t){const e=new TextEncoder().encode(t.styleSheet).length;if(e>o)throw new p(`<style amp-custom> is ${e} bytes, over the ${o}-byte AMP4EMAIL cap`);const l=t.settings.direction==="rtl"?"rtl":"ltr",s=t.settings.lang?` lang="${h(t.settings.lang)}"`:"",i=[...t.components],n=r(i),c=n.length>0?`
${n.join(`
`)}`:"",m=t.styleSheet!==""?`
<style amp-custom>${t.styleSheet}</style>`:"",a=i.includes("amp-image-lightbox")?`
<amp-image-lightbox id="${y}" layout="nodisplay"></amp-image-lightbox>`:"";return`<!doctype html>
<html amp4email${s} dir="${l}">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,minimum-scale=1">
<style amp4email-boilerplate>body{visibility:hidden}</style>
<script async src="${d}"><\/script>${c}${m}
</head>
<body>${a}
${t.body}
</body>
</html>`}export{$ as ampFinalize};
