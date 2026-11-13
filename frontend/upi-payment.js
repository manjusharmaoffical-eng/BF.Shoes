document.querySelectorAll('[data-copy]').forEach(button=>button.addEventListener('click',async()=>{
  const value=document.getElementById(button.dataset.copy).textContent.trim();
  try{await navigator.clipboard.writeText(value);button.textContent='Copied';}
  catch{button.textContent=value+' — select and copy';}
}));
