/**
 * FORM · Body Lab — Setup Module
 */
var AI, db;

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
    if(!ds.startsWith('sk-')){if(err)err.textContent='DeepSeek Key 格式不对（应以 sk- 开头）';return;}
    if(!su.includes('supabase.co')){if(err)err.textContent='Supabase URL 格式不对';return;}
    if(!sk){if(err)err.textContent='请输入 Supabase anon key';return;}
    var btn=document.getElementById('s-btn');if(!btn)throw new Error('找不到按钮');
    btn.textContent='连接中…';btn.disabled=true;btn.style.opacity='0.6';
    localStorage.setItem('form_ds',ds);localStorage.setItem('form_gm',gm||'');
    localStorage.setItem('form_su',su);localStorage.setItem('form_sk',sk);
    if(typeof supabase==='undefined')throw new Error('请用 https 打开');
    window.db=db=new DB(su,sk);
    await Promise.race([db.init(),new Promise(function(_,rej){setTimeout(function(){rej(new Error('连接超时'));},15000);})]);
    window.AI=AI=new AIProvider(ds,gm||null);
    localStorage.setItem('form_connected','1');
    
    // 进入 App
    document.getElementById('setup').classList.add('off');
    document.getElementById('app').classList.remove('off');
    try{
      var ds2=(typeof todayStr==='function'?todayStr():new Date().toLocaleDateString('zh-CN',{month:'numeric',day:'numeric',weekday:'short'}));
      ['dash-date','train-date','train-badge'].forEach(function(id){var el=document.getElementById(id);if(el)el.textContent=ds2;});
    }catch(e){}
    
    // 尝试调 boot()，没有就跳过
    if(typeof boot==='function')await boot();
    else if(typeof window.boot==='function')await window.boot();
    
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
