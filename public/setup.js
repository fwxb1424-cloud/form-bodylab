/**
 * FORM · Body Lab — Setup Module
 * 独立文件，不依赖主脚本块，确保 setup 始终可用
 */

// ══ GLOBALS (duplicated from index.html for safety) ══
var AI, db;

// ══ SETUP ══
async function doSetup(){
  try{
    var dsEl=document.getElementById('in-ds');if(!dsEl)throw new Error('找不到 DS 输入框');
    var ds=dsEl.value.trim();
    var gmEl=document.getElementById('in-gm');var gm=gmEl?gmEl.value.trim():'';
    var suEl=document.getElementById('in-su');if(!suEl)throw new Error('找不到 SU 输入框');
    var su=suEl.value.trim();
    var skEl=document.getElementById('in-sk');if(!skEl)throw new Error('找不到 SK 输入框');
    var sk=skEl.value.trim();
    var err=document.getElementById('s-err');
    if(err)err.textContent='';
    if(!ds.startsWith('sk-')){if(err){err.style.color='var(--da)';err.style.background='rgba(232,88,88,.08)';err.style.borderColor='rgba(232,88,88,.2)';err.textContent='DeepSeek Key 格式不对（应以 sk- 开头）';}return;}
    if(!su.includes('supabase.co')){if(err){err.style.color='var(--da)';err.style.background='rgba(232,88,88,.08)';err.style.borderColor='rgba(232,88,88,.2)';err.textContent='Supabase URL 格式不对';}return;}
    if(!sk){if(err){err.style.color='var(--da)';err.style.background='rgba(232,88,88,.08)';err.style.borderColor='rgba(232,88,88,.2)';err.textContent='请输入 Supabase anon key';}return;}
    var btn=document.getElementById('s-btn');if(!btn)throw new Error('找不到按钮');
    btn.textContent='连接中…';btn.disabled=true;btn.style.opacity='0.6';
    localStorage.setItem('form_ds',ds);localStorage.setItem('form_gm',gm||'');
    localStorage.setItem('form_su',su);localStorage.setItem('form_sk',sk);
    if(err){err.style.display='block';err.style.color='var(--t2)';err.style.background='transparent';err.style.borderColor='transparent';err.textContent='正在连接…';}
    if(typeof supabase==='undefined')throw new Error('Supabase 脚本未加载，请用 https 打开');
    window.db=db=new DB(su,sk);
    await Promise.race([db.init(),new Promise(function(_,rej){setTimeout(function(){rej(new Error('连接超时'));},15000);})]);
    window.AI=AI=new AIProvider(ds,gm||null);
    localStorage.setItem('form_connected','1');
    var bootFn = typeof boot==='function' ? boot : (typeof window.boot==='function' ? window.boot : null);
    if(bootFn){await bootFn();}
    else{throw new Error('系统未完全加载，请刷新页面');}
    if(err){err.textContent='';err.style.display='none';}
    if(typeof toast==='function')toast('已连接云端数据库与 DeepSeek');
  }catch(e){
    window.db=null;window.AI=null;
    if(typeof toast==='function')toast('连接失败：'+e.message);
    var err2=document.getElementById('s-err');
    if(err2){err2.style.display='block';err2.style.color='var(--da)';err2.style.background='rgba(232,88,88,.08)';err2.style.borderColor='rgba(232,88,88,.2)';err2.textContent='连接失败：'+e.message;}
    var btn2=document.getElementById('s-btn');
    if(btn2){btn2.textContent='开始使用 →';btn2.disabled=false;btn2.style.opacity='';}
  }
}

window.doSetup = doSetup;
