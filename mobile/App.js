import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ActivityIndicator, Alert, AppState, Modal, Pressable, SafeAreaView,
  ScrollView, StatusBar, StyleSheet, Text, TextInput, View,
} from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import * as SecureStore from 'expo-secure-store';
import {
  FINNHUB_TOKEN_KEY, MARKET_REFRESH_MS, fetchPortfolioQuotes, openFinnhubTrades, quoteStatusText,
} from './src/market-data';

const STORAGE_KEY = 'investor-control-mobile-state-v2';
const VERSION = '0.2.0';
const INITIAL_STATE = {
  transactions: [
    { id:'alwn-20260716', type:'buy', symbol:'ALWN.GR', company:'Allwyn', date:'2026-07-16', quantity:193, currency:'EUR', price:13.57, fees:11.95, total:2630.96, broker:'Τράπεζα Πειραιώς' },
    { id:'spce-20260303', type:'buy', symbol:'SPCE.US', company:'Virgin Galactic Holdings', date:'2026-03-03', quantity:720, currency:'USD', price:3.17, fees:0, total:2282.72, broker:'Freedom24' },
  ],
  prices:{},
  meta:{ lastCheckedAt:null, errors:[] },
};

const valid = (v) => v !== null && v !== undefined && Number.isFinite(Number(v));
const cash = (v,c='EUR') => valid(v) ? new Intl.NumberFormat('el-GR',{style:'currency',currency:c,maximumFractionDigits:2}).format(Number(v)) : '—';
const quotePrice = (v,c='EUR') => valid(v) ? new Intl.NumberFormat('el-GR',{style:'currency',currency:c,minimumFractionDigits:2,maximumFractionDigits:3}).format(Number(v)) : '—';
const pct = (v) => valid(v) ? `${Number(v)>0?'+':''}${Number(v).toFixed(2)}%` : '—';
const when = (v) => v ? new Date(v).toLocaleString('el-GR') : '—';
const parseNum = (v) => { const x=String(v??'').trim(); const n=Number(x.includes(',')?x.replace(/\./g,'').replace(',','.'):x); return Number.isFinite(n)?n:0; };

function positionsFrom(state){
  const ledger={};
  [...state.transactions].sort((a,b)=>String(a.date).localeCompare(String(b.date))).forEach((tx)=>{
    if(!['buy','sell'].includes(tx.type)) return;
    const symbol=String(tx.symbol||'').toUpperCase(); const qty=Number(tx.quantity||0); if(!symbol||qty<=0) return;
    const p=ledger[symbol]||{symbol,company:tx.company||symbol,currency:tx.currency||(symbol.endsWith('.US')?'USD':'EUR'),quantity:0,cost:0};
    const total=valid(tx.total)?Number(tx.total):qty*Number(tx.price||0)+Number(tx.fees||0);
    if(tx.type==='buy'){p.quantity+=qty;p.cost+=total;} else if(p.quantity>0){const sold=Math.min(qty,p.quantity);p.cost-=p.cost/p.quantity*sold;p.quantity-=sold;}
    ledger[symbol]=p;
  });
  return Object.values(ledger).filter(p=>p.quantity>0).map((p)=>{
    const q=state.prices[p.symbol]; const usable=q?.usable===true;
    const native=usable?Number(q.nativePrice):null; const eur=usable?Number(q.price):null; const fx=p.currency==='USD'?Number(q?.fxRate||0):1;
    const nativeValue=native===null?null:native*p.quantity; const eurValue=eur===null?null:eur*p.quantity;
    const nativePnl=nativeValue===null?null:nativeValue-p.cost; const eurCost=p.currency==='USD'&&fx>0?p.cost/fx:p.cost;
    return {...p,quote:q,nativePrice:native,eurPrice:eur,nativeValue,eurValue,nativePnl,nativePct:nativePnl===null?null:nativePnl/p.cost*100,eurCost,eurPnl:eurValue===null?null:eurValue-eurCost,average:p.cost/p.quantity};
  });
}

function Badge({quote}){ const text=quoteStatusText(quote); const bad=quote?.status==='stale'; return <View style={[s.badge,bad&&s.badgeBad]}><Text style={[s.badgeText,bad&&s.badgeBadText]}>{text}</Text></View>; }
function Metric({label,value,negative}){return <View style={s.metric}><Text style={s.muted}>{label}</Text><Text style={[s.metricValue,negative&&s.red]}>{value}</Text></View>;}

function Position({item}){
  const stale=item.quote&&!item.quote.usable;
  return <View style={s.card}>
    <View style={s.row}><View style={s.grow}><Text style={s.cardTitle}>{item.company}</Text><Text style={s.muted}>{item.symbol} · {item.quantity.toLocaleString('el-GR')} μετοχές</Text></View><Badge quote={item.quote}/></View>
    <View style={s.row}><View><Text style={s.muted}>Τρέχουσα τιμή</Text><Text style={s.big}>{stale?'—':quotePrice(item.nativePrice,item.currency)}</Text>{item.currency==='USD'&&!stale?<Text style={s.muted}>≈ {quotePrice(item.eurPrice,'EUR')}</Text>:null}</View><Text style={[s.change,Number(item.quote?.changePct)<0?s.red:s.green]}>{stale?'—':pct(item.quote?.changePct)}</Text></View>
    <View style={s.grid}><Metric label="Αξία θέσης" value={cash(item.nativeValue,item.currency)}/><Metric label="Συνολικό κόστος" value={cash(item.cost,item.currency)}/><Metric label="Κέρδος / Ζημία" value={cash(item.nativePnl,item.currency)} negative={Number(item.nativePnl)<0}/><Metric label="Μέση τιμή" value={quotePrice(item.average,item.currency)}/></View>
    {item.currency==='USD'&&item.eurValue!==null?<Text style={s.note}>Σε ευρώ: αξία ≈ {cash(item.eurValue)} · αποτέλεσμα ≈ {cash(item.eurPnl)}</Text>:null}
    <Text style={s.source}>Πηγή: {item.quote?.source||'—'}{item.quote?.updatedAt?`\nΤιμή: ${when(item.quote.updatedAt)} · Έλεγχος: ${when(item.quote.checkedAt)}`:''}</Text>
    {stale?<Text style={s.warning}>Η τιμή είναι παρωχημένη και εξαιρείται από τους υπολογισμούς.</Text>:null}
  </View>;
}

function AddModal({visible,onClose,onSave}){
  const [f,setF]=useState({symbol:'',company:'',quantity:'',price:'',fees:'0',currency:'EUR',broker:''});
  const set=(k,v)=>setF(x=>({...x,[k]:v}));
  const save=()=>{const quantity=parseNum(f.quantity),priceValue=parseNum(f.price),fees=parseNum(f.fees);if(!f.symbol.trim()||quantity<=0||priceValue<=0){Alert.alert('Λείπουν στοιχεία','Συμπλήρωσε σύμβολο, ποσότητα και τιμή.');return;}onSave({id:`tx-${Date.now()}`,type:'buy',symbol:f.symbol.trim().toUpperCase(),company:f.company.trim()||f.symbol.trim().toUpperCase(),date:new Date().toISOString().slice(0,10),quantity,currency:f.currency,price:priceValue,fees,total:quantity*priceValue+fees,broker:f.broker.trim()});setF({symbol:'',company:'',quantity:'',price:'',fees:'0',currency:'EUR',broker:''});onClose();};
  return <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}><View style={s.overlay}><SafeAreaView style={s.sheet}><ScrollView contentContainerStyle={s.form} keyboardShouldPersistTaps="handled"><View style={s.row}><Text style={s.section}>Νέα αγορά</Text><Pressable onPress={onClose}><Text style={s.link}>Κλείσιμο</Text></Pressable></View>{[['symbol','Σύμβολο, π.χ. SPCE.US'],['company','Εταιρεία'],['quantity','Μετοχές'],['price','Τιμή ανά μετοχή'],['fees','Προμήθεια / έξοδα'],['broker','Broker / τράπεζα']].map(([k,p])=><TextInput key={k} style={s.input} placeholder={p} value={f[k]} onChangeText={v=>set(k,v)} keyboardType={['quantity','price','fees'].includes(k)?'decimal-pad':'default'} autoCapitalize={k==='symbol'?'characters':'sentences'}/>)}<View style={s.row}>{['EUR','USD'].map(c=><Pressable key={c} onPress={()=>set('currency',c)} style={[s.currency,f.currency===c&&s.currencyOn]}><Text style={[s.currencyText,f.currency===c&&s.white]}>{c}</Text></Pressable>)}</View><Pressable style={s.primary} onPress={save}><Text style={s.whiteStrong}>Αποθήκευση</Text></Pressable></ScrollView></SafeAreaView></View></Modal>;
}

export default function App(){
  const [state,setState]=useState(INITIAL_STATE); const stateRef=useRef(INITIAL_STATE); const [tab,setTab]=useState('summary'); const [loading,setLoading]=useState(true); const [refreshing,setRefreshing]=useState(false); const [modal,setModal]=useState(false); const [token,setToken]=useState(''); const tokenRef=useRef(''); const appState=useRef(AppState.currentState);
  const persist=useCallback(async(next)=>{stateRef.current=next;setState(next);await AsyncStorage.setItem(STORAGE_KEY,JSON.stringify(next));},[]);
  useEffect(()=>{(async()=>{try{const [saved,secret]=await Promise.all([AsyncStorage.getItem(STORAGE_KEY),SecureStore.getItemAsync(FINNHUB_TOKEN_KEY)]);const next=saved?JSON.parse(saved):INITIAL_STATE;stateRef.current=next;setState(next);tokenRef.current=secret||'';setToken(secret||'');if(!saved)await AsyncStorage.setItem(STORAGE_KEY,JSON.stringify(next));}catch{Alert.alert('Εκκίνηση','Δεν φορτώθηκαν σωστά τα δεδομένα.');}finally{setLoading(false);}})();},[]);
  const refresh=useCallback(async({silent=false}={})=>{if(!silent)setRefreshing(true);try{const current=stateRef.current;const symbols=[...new Set(current.transactions.map(t=>String(t.symbol||'').toUpperCase()).filter(Boolean))];const result=await fetchPortfolioQuotes(symbols,{finnhubToken:tokenRef.current});const next={...current,prices:{...current.prices,...result.quotes},meta:{lastCheckedAt:result.checkedAt,errors:result.errors}};await persist(next);if(!silent&&result.errors.length)Alert.alert('Μερική ενημέρωση',result.errors.join('\n'));}catch(e){if(!silent)Alert.alert('Ανανέωση',e.message);}finally{if(!silent)setRefreshing(false);}},[persist]);
  useEffect(()=>{if(loading)return;refresh({silent:true});const id=setInterval(()=>refresh({silent:true}),MARKET_REFRESH_MS);const sub=AppState.addEventListener('change',n=>{if(appState.current.match(/inactive|background/)&&n==='active')refresh({silent:true});appState.current=n;});return()=>{clearInterval(id);sub.remove();};},[loading,refresh]);
  useEffect(()=>{if(loading||token.trim().length<20)return;return openFinnhubTrades(token.trim(),['SPCE'],(trade)=>{const current=stateRef.current;const old=current.prices['SPCE.US'];const fx=Number(old?.fxRate||0);if(!fx)return;const previous=Number(old?.nativePreviousClose||0);const quote={...old,nativePrice:trade.price,price:trade.price/fx,updatedAt:new Date(trade.timestamp).toISOString(),checkedAt:new Date().toISOString(),source:'Finnhub WebSocket real-time trade',quality:'realtime',status:'live',usable:true,ageSeconds:0,changePct:previous>0?(trade.price-previous)/previous*100:old?.changePct};const next={...current,prices:{...current.prices,'SPCE.US':quote},meta:{...current.meta,lastCheckedAt:new Date().toISOString()}};stateRef.current=next;setState(next);AsyncStorage.setItem(STORAGE_KEY,JSON.stringify(next)).catch(()=>{});});},[loading,token]);
  const positions=useMemo(()=>positionsFrom(state),[state]); const allUsable=positions.length>0&&positions.every(p=>p.eurValue!==null); const totalValue=allUsable?positions.reduce((a,p)=>a+p.eurValue,0):null; const totalCost=allUsable?positions.reduce((a,p)=>a+p.eurCost,0):null; const totalPnl=allUsable?totalValue-totalCost:null;
  const saveToken=async()=>{const clean=token.trim();if(clean)await SecureStore.setItemAsync(FINNHUB_TOKEN_KEY,clean);else await SecureStore.deleteItemAsync(FINNHUB_TOKEN_KEY);tokenRef.current=clean;Alert.alert('Αποθηκεύτηκε','Το Finnhub token μένει κρυπτογραφημένο μόνο στη συσκευή.');refresh();};
  const add=async(tx)=>persist({...stateRef.current,transactions:[...stateRef.current.transactions,tx]});
  if(loading)return <SafeAreaView style={s.center}><ActivityIndicator size="large"/><Text>Φόρτωση…</Text></SafeAreaView>;
  return <SafeAreaView style={s.safe}><StatusBar barStyle="dark-content"/><View style={s.app}><ScrollView contentContainerStyle={s.content}><Text style={s.eyebrow}>ΠΡΟΣΩΠΙΚΟ ΧΑΡΤΟΦΥΛΑΚΙΟ</Text><View style={s.row}><Text style={s.title}>Investor Control</Text><Pressable style={s.plus} onPress={()=>setModal(true)}><Text style={s.plusText}>＋</Text></Pressable></View>
    {tab==='summary'?<><View style={s.refresh}><View style={s.grow}><Text style={s.muted}>Τελευταίος έλεγχος</Text><Text style={s.checked}>{when(state.meta.lastCheckedAt)}</Text></View><Pressable style={s.primarySmall} onPress={()=>refresh()} disabled={refreshing}>{refreshing?<ActivityIndicator color="#fff"/>:<Text style={s.whiteStrong}>Ανανέωση</Text>}</Pressable></View>{state.meta.errors?.length?<Text style={s.warning}>{state.meta.errors.join('\n')}</Text>:null}<View style={s.grid}><Metric label="Αξία χαρτοφυλακίου" value={cash(totalValue)}/><Metric label="Καθαρό κόστος" value={cash(totalCost)}/><Metric label="Κέρδος / Ζημία" value={cash(totalPnl)} negative={Number(totalPnl)<0}/><Metric label="Θέσεις" value={String(positions.length)}/></View>{!allUsable?<Text style={s.warning}>Η συνολική αποτίμηση μένει κενή όταν υπάρχει παρωχημένη ή αποτυχημένη τιμή.</Text>:null}<Text style={s.section}>Θέσεις</Text>{positions.map(p=><Position key={p.symbol} item={p}/>)}</>:null}
    {tab==='transactions'?<><Text style={s.section}>Συναλλαγές</Text>{state.transactions.map(tx=><View key={tx.id} style={s.card}><View style={s.row}><View style={s.grow}><Text style={s.txTitle}>Αγορά · {tx.company}</Text><Text style={s.muted}>{tx.symbol} · {tx.date}</Text></View><Text style={s.txTitle}>-{cash(tx.total,tx.currency)}</Text></View><Text style={s.note}>{tx.quantity} × {quotePrice(tx.price,tx.currency)} · έξοδα {cash(tx.fees,tx.currency)}</Text></View>)}</>:null}
    {tab==='settings'?<><Text style={s.section}>Ρυθμίσεις</Text><View style={s.card}><Text style={s.cardTitle}>Πηγές τιμών</Text><Text style={s.note}>Allwyn: επίσημη Euronext Athens με δηλωμένη καθυστέρηση 15′. SPCE: Finnhub WebSocket real-time όταν βάλεις δικό σου token. Χωρίς token χρησιμοποιείται εφεδρική ανεπίσημη πηγή.</Text><TextInput style={s.input} placeholder="Finnhub API token" value={token} onChangeText={setToken} autoCapitalize="none" autoCorrect={false} secureTextEntry/><Pressable style={s.primary} onPress={saveToken}><Text style={s.whiteStrong}>Αποθήκευση token</Text></Pressable><Text style={s.source}>Έκδοση {VERSION} · Αυτόματος έλεγχος κάθε 30″ όσο η εφαρμογή είναι ενεργή.</Text></View></>:null}
  </ScrollView><View style={s.tabs}>{[['summary','Σύνοψη'],['transactions','Συναλλαγές'],['settings','Ρυθμίσεις']].map(([k,l])=><Pressable key={k} style={[s.tab,tab===k&&s.tabOn]} onPress={()=>setTab(k)}><Text style={[s.tabText,tab===k&&s.tabTextOn]}>{l}</Text></Pressable>)}</View></View><AddModal visible={modal} onClose={()=>setModal(false)} onSave={add}/></SafeAreaView>;
}

const s=StyleSheet.create({safe:{flex:1,backgroundColor:'#eef5ff'},app:{flex:1},content:{padding:20,paddingBottom:100,gap:16},center:{flex:1,alignItems:'center',justifyContent:'center',gap:12},eyebrow:{color:'#0b66ff',fontWeight:'900',letterSpacing:1.5},title:{fontSize:34,fontWeight:'900',color:'#10233f',flex:1},section:{fontSize:28,fontWeight:'900',color:'#10233f',marginTop:6},row:{flexDirection:'row',alignItems:'center',justifyContent:'space-between',gap:12},grow:{flex:1},plus:{width:54,height:54,borderRadius:18,backgroundColor:'#fff',alignItems:'center',justifyContent:'center',borderWidth:1,borderColor:'#dbe3ef'},plusText:{fontSize:34},refresh:{flexDirection:'row',alignItems:'center',backgroundColor:'#fff',borderRadius:24,padding:18,borderWidth:1,borderColor:'#dbe3ef'},checked:{fontSize:17,fontWeight:'900',color:'#10233f',marginTop:4},primary:{backgroundColor:'#0b66ff',borderRadius:16,padding:16,alignItems:'center'},primarySmall:{backgroundColor:'#0b66ff',borderRadius:16,padding:14,minWidth:112,alignItems:'center'},whiteStrong:{color:'#fff',fontWeight:'900'},grid:{flexDirection:'row',flexWrap:'wrap',gap:12},metric:{width:'48%',minHeight:110,backgroundColor:'#fff',borderRadius:22,padding:17,borderWidth:1,borderColor:'#dbe3ef',justifyContent:'space-between'},metricValue:{fontSize:21,fontWeight:'900',color:'#10233f'},card:{backgroundColor:'#fff',borderRadius:25,padding:20,borderWidth:1,borderColor:'#dbe3ef',gap:15},cardTitle:{fontSize:23,fontWeight:'900',color:'#10233f'},txTitle:{fontSize:17,fontWeight:'900',color:'#10233f'},muted:{fontSize:15,color:'#7c879a',lineHeight:21},note:{fontSize:14,color:'#66758c',lineHeight:20},source:{fontSize:12,color:'#78869b',lineHeight:18},big:{fontSize:36,fontWeight:'900',color:'#10233f'},change:{fontSize:17,fontWeight:'900'},red:{color:'#d63d4c'},green:{color:'#14884f'},badge:{backgroundColor:'#edf4ff',paddingHorizontal:12,paddingVertical:7,borderRadius:14},badgeText:{fontWeight:'900',color:'#075ed1',fontSize:12},badgeBad:{backgroundColor:'#fff0f1'},badgeBadText:{color:'#c92e3d'},warning:{backgroundColor:'#fff5e7',color:'#7a4e00',padding:12,borderRadius:14,lineHeight:20},tabs:{position:'absolute',bottom:0,left:0,right:0,backgroundColor:'#fff',borderTopWidth:1,borderTopColor:'#dbe3ef',padding:8,flexDirection:'row'},tab:{flex:1,minHeight:56,alignItems:'center',justifyContent:'center',borderRadius:16},tabOn:{backgroundColor:'#edf4ff'},tabText:{color:'#768297',fontWeight:'800'},tabTextOn:{color:'#0b66ff'},overlay:{flex:1,backgroundColor:'rgba(7,22,44,.55)',justifyContent:'flex-end'},sheet:{maxHeight:'92%',backgroundColor:'#f8faff',borderTopLeftRadius:28,borderTopRightRadius:28},form:{padding:22,gap:13,paddingBottom:34},input:{minHeight:56,backgroundColor:'#fff',borderWidth:1,borderColor:'#d7e0ec',borderRadius:16,paddingHorizontal:15,fontSize:16,color:'#10233f'},currency:{flex:1,borderWidth:1,borderColor:'#d7e0ec',backgroundColor:'#fff',borderRadius:15,padding:14,alignItems:'center'},currencyOn:{backgroundColor:'#0b66ff'},currencyText:{fontWeight:'900',color:'#10233f'},white:{color:'#fff'},link:{color:'#0b66ff',fontWeight:'900'}});
