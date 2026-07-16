(() => {
  'use strict';
  const KEY='investor-control-state-v3';
  const VERSION='0.6.0';
  const money=new Intl.NumberFormat('el-GR',{minimumFractionDigits:2,maximumFractionDigits:2});
  const price=new Intl.NumberFormat('el-GR',{minimumFractionDigits:2,maximumFractionDigits:3});
  const percent=new Intl.NumberFormat('el-GR',{minimumFractionDigits:2,maximumFractionDigits:2});
  let scheduled=false;
  const n=v=>Number.isFinite(Number(v))?Number(v):0;
  const usd=s=>/\.(US|NYSE|NASDAQ)$/i.test(String(s||''));
  const load=()=>{try{return JSON.parse(localStorage.getItem(KEY))||null}catch(_){return null}};
  const save=s=>localStorage.setItem(KEY,JSON.stringify(s));

  function migrate(state){
    let changed=false;
    for(const tx of state.transactions||[]){
      if(!tx?.symbol)continue;
      const currency=tx.nativeCurrency||tx.currency||(usd(tx.symbol)?'USD':'EUR');
      if(!tx.nativeCurrency){tx.nativeCurrency=currency;changed=true}
      if(['buy','sell'].includes(tx.type)&&!Number.isFinite(Number(tx.nativePrice))){tx.nativePrice=n(tx.price);changed=true}
      if(!Number.isFinite(Number(tx.nativeFees))){tx.nativeFees=n(tx.fees);changed=true}
      if(!Number.isFinite(Number(tx.nativeTax))){tx.nativeTax=n(tx.tax);changed=true}
      if(['buy','sell'].includes(tx.type)&&!Number.isFinite(Number(tx.nativeTotal))){
        const q=n(tx.quantity);
        const known=String(tx.symbol).toUpperCase()==='SPCE.US'&&q===720&&String(tx.date||'').startsWith('2026-03-03')&&Math.abs(n(tx.nativePrice)-3.17)<0.01;
        tx.nativeTotal=known?2282.72:q*n(tx.nativePrice)+n(tx.nativeFees)+n(tx.nativeTax);
        tx.nativeAveragePrice=q>0?tx.nativeTotal/q:n(tx.nativePrice);
        tx.currencySource=known?'Freedom24 statement':'inferred from symbol';
        changed=true;
      }
    }
    state.meta=state.meta||{};
    if(state.meta.currencyAccountingVersion!==VERSION){state.meta.currencyAccountingVersion=VERSION;changed=true}
    if(changed)save(state);
    return state;
  }

  function ledger(state){
    const out={};
    const txs=[...(state.transactions||[])].sort((a,b)=>String(a.date||'').localeCompare(String(b.date||'')));
    for(const tx of txs){
      if(!['buy','sell'].includes(tx.type))continue;
      const symbol=String(tx.symbol||'').trim().toUpperCase();
      const q=n(tx.quantity);if(!symbol||q<=0)continue;
      const currency=tx.nativeCurrency||(usd(symbol)?'USD':'EUR');
      const total=Number.isFinite(Number(tx.nativeTotal))?Number(tx.nativeTotal):q*n(tx.nativePrice??tx.price)+n(tx.nativeFees??tx.fees)+n(tx.nativeTax??tx.tax);
      const p=out[symbol]||{symbol,currency,quantity:0,nativeCost:0};
      if(tx.type==='buy'){p.quantity+=q;p.nativeCost+=total}
      else if(p.quantity>0){const sold=Math.min(q,p.quantity);const avg=p.nativeCost/p.quantity;p.quantity-=sold;p.nativeCost-=avg*sold}
      out[symbol]=p;
    }
    for(const [symbol,p] of Object.entries(out)){
      if(p.quantity<=0){delete out[symbol];continue}
      const q=state.prices?.[symbol];p.quote=q;
      p.fx=p.currency==='USD'?n(q?.fxRate):1;
      p.nativePrice=p.currency==='USD'?n(q?.nativePrice||(p.fx?n(q?.price)*p.fx:0)):n(q?.price);
      p.nativeValue=p.quantity*p.nativePrice;
      p.nativePnl=p.nativeValue-p.nativeCost;
      p.nativePct=p.nativeCost>0?p.nativePnl/p.nativeCost*100:0;
      p.avgNative=p.quantity>0?p.nativeCost/p.quantity:0;
      p.eurValue=n(q?.price)*p.quantity;
      p.eurCost=p.currency==='USD'&&p.fx>0?p.nativeCost/p.fx:p.nativeCost;
      p.eurPnl=p.eurValue-p.eurCost;
    }
    return out;
  }

  function exact(root,text){return [...root.querySelectorAll('*')].find(e=>e.children.length===0&&e.textContent.trim()===text)||null}
  function setMetric(card,label,value){
    const node=exact(card,label);if(!node)return;
    let parent=node.parentElement;
    for(let i=0;i<3&&parent;i++,parent=parent.parentElement){
      const strong=parent.querySelector('strong');
      if(strong&&strong!==node){strong.textContent=value;return}
      const children=[...parent.children].filter(c=>c!==node);
      const target=children.at(-1);if(target&&target.textContent.trim()!==label){target.textContent=value;return}
    }
  }
  function signed(v,c){const sign=v<0?'-':v>0?'+':'';return c==='USD'?`${sign}$${money.format(Math.abs(v))}`:`${sign}${money.format(Math.abs(v))} €`}

  function patchCards(positions){
    const list=document.getElementById('positionsList');if(!list)return;
    for(const card of list.children){
      const symbol=Object.keys(positions).find(s=>card.textContent.includes(s));if(!symbol)continue;
      const p=positions[symbol];if(p.currency!=='USD'||!p.quote||p.nativePrice<=0)continue;
      setMetric(card,'Τρέχουσα τιμή',`$${price.format(p.nativePrice)} · ${price.format(n(p.quote.price))} €`);
      setMetric(card,'Αξία θέσης',`$${money.format(p.nativeValue)} · ${money.format(p.eurValue)} €`);
      setMetric(card,'Συνολικό κόστος',`$${money.format(p.nativeCost)} · ≈${money.format(p.eurCost)} €`);
      setMetric(card,'Κέρδος / Ζημία',`${signed(p.nativePnl,'USD')} · ≈${signed(p.eurPnl,'EUR')}`);
      setMetric(card,'Μέση τιμή κτήσης',`$${price.format(p.avgNative)}`);
      if(!card.querySelector('.currency-note')){const note=document.createElement('p');note.className='currency-note muted';note.style.cssText='margin:14px 0 0;font-size:.82rem';note.textContent='Θέση σε USD. Τα ποσά σε € είναι μετατροπή με την τρέχουσα ισοτιμία.';card.appendChild(note)}
    }
  }

  function patchTransactions(state,positions){
    const list=document.getElementById('transactionsList');if(!list)return;
    for(const card of list.children){
      const symbol=Object.keys(positions).find(s=>positions[s].currency==='USD'&&card.textContent.includes(s));if(!symbol)continue;
      const tx=(state.transactions||[]).find(t=>String(t.symbol).toUpperCase()===symbol&&t.type==='buy');if(!tx)continue;
      const total=n(tx.nativeTotal);const q=n(tx.quantity);const avg=q>0?total/q:n(tx.nativePrice||tx.price);
      for(const el of card.querySelectorAll('*')){const t=el.textContent.trim();if(el.children.length)continue;
        if(/^-?[\d.]+,[\d]{2}\s*€$/.test(t))el.textContent=`-$${money.format(total)}`;
        if(t.includes('×')&&t.includes('€'))el.textContent=`${money.format(q)} × $${price.format(avg)} · κόστος $${money.format(total)}`;
      }
    }
  }

  function patchSummary(positions){
    const ps=Object.values(positions).filter(p=>p.quote&&p.eurValue>=0&&p.eurCost>=0);if(!ps.length)return;
    const value=ps.reduce((s,p)=>s+p.eurValue,0),cost=ps.reduce((s,p)=>s+p.eurCost,0),pnl=value-cost,pctv=cost>0?pnl/cost*100:0;
    const map={portfolioValue:`${money.format(value)} €`,portfolioCost:`${money.format(cost)} €`,portfolioPnL:signed(pnl,'EUR'),portfolioPnLPct:`${pctv>=0?'+':''}${percent.format(pctv)}%`};
    for(const [id,text] of Object.entries(map)){const el=document.getElementById(id);if(el)el.textContent=text}
    const grid=document.querySelector('.summary-grid');
    if(grid&&!document.getElementById('currencySummaryNote')&&ps.some(p=>p.currency==='USD')){const note=document.createElement('p');note.id='currencySummaryNote';note.className='muted';note.style.cssText='grid-column:1/-1;margin:0 4px;font-size:.78rem';note.textContent='* Οι θέσεις USD μετατρέπονται με την τρέχουσα ισοτιμία. Η απόδοση της μετοχής εμφανίζεται στο αρχικό νόμισμα.';grid.appendChild(note)}
  }

  function version(){document.querySelectorAll('.details-list div').forEach(r=>{const dt=r.querySelector('dt'),dd=r.querySelector('dd');if(dt?.textContent.trim()==='Έκδοση'&&dd)dd.textContent=VERSION})}
  function patch(){scheduled=false;const raw=load();if(!raw)return;const state=migrate(raw),positions=ledger(state);patchCards(positions);patchTransactions(state,positions);patchSummary(positions);version()}
  function queue(){if(scheduled)return;scheduled=true;setTimeout(patch,80)}
  function start(){patch();new MutationObserver(queue).observe(document.body,{childList:true,subtree:true});document.addEventListener('visibilitychange',()=>{if(document.visibilityState==='visible')queue()});setInterval(queue,5000)}
  if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',start,{once:true});else start();
})();