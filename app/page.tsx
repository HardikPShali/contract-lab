"use client";
import {useMemo,useState} from "react";
import {AlertTriangle,ArrowRight,Braces,Check,ChevronDown,ChevronRight,Clock3,Code2,Command,Copy,GitBranch,GitCompare,History,Play,Plus,Search,Settings,ShieldCheck,TerminalSquare,X} from "lucide-react";
import {Tabs,TabsContent,TabsList,TabsTrigger} from "@/components/ui/tabs";

type Endpoint={method:string,path:string,label:string,changes:number,status:"safe"|"breaking"};
const endpoints:Endpoint[]=[
 {method:"POST",path:"/v1/orders",label:"Create order",changes:3,status:"breaking"},
 {method:"GET",path:"/v1/orders/{id}",label:"Get order",changes:1,status:"safe"},
 {method:"PATCH",path:"/v1/orders/{id}",label:"Update order",changes:2,status:"breaking"},
 {method:"GET",path:"/v1/customers",label:"List customers",changes:1,status:"safe"},
 {method:"POST",path:"/v1/refunds",label:"Create refund",changes:2,status:"safe"}
];
const currentLines=[["1","{"],["2",'  "type": "object",'],["3",'  "required": ["customerId", "items"],'],["4",'  "properties": {'],["5",'    "customerId": { "type": "string" },'],["6",'    "items": { "type": "array" },'],["7",'    "couponCode": { "type": "string" },'],["8",'    "notes": { "type": "string" }'],["9","  }"],["10","}"]];
const proposedLines=[["1","{"],["2",'  "type": "object",'],["3",'  "required": ["customerId", "items", "currency"],'],["4",'  "properties": {'],["5",'    "customerId": { "type": "uuid" },'],["6",'    "items": { "type": "array", "minItems": 1 },'],["7",'    "currency": { "enum": ["EUR", "USD"] },'],["8",'    "metadata": { "type": "object" }'],["9","  }"],["10","}"]];
const issues=[{kind:"breaking",title:"Required field added",detail:"currency is now required",line:"Line 3"},{kind:"breaking",title:"Format narrowed",detail:"customerId changed from string to UUID",line:"Line 5"},{kind:"safe",title:"Validation strengthened",detail:"items now requires at least one entry",line:"Line 6"}];

export default function Home(){
 const [selected,setSelected]=useState(endpoints[0]);const [query,setQuery]=useState("");const [body,setBody]=useState('{\n  "customerId": "cus_8291",\n  "items": [{ "sku": "CHAIR-01", "qty": 1 }],\n  "currency": "EUR"\n}');const [sent,setSent]=useState(false);const [copied,setCopied]=useState(false);
 const visible=useMemo(()=>endpoints.filter(e=>(e.path+e.label).toLowerCase().includes(query.toLowerCase())),[query]);
 const send=()=>{setSent(false);setTimeout(()=>setSent(true),350)};const copy=()=>{navigator.clipboard?.writeText(body);setCopied(true);setTimeout(()=>setCopied(false),1000)};
 return <main className="shell">
  <aside className="rail"><div className="logo"><Command/><b>CL</b></div><nav><a className="active" href="#contracts" aria-label="Contracts"><Braces/></a><a href="#terminal" aria-label="Request runner"><TerminalSquare/></a><a href="#history" aria-label="History"><History/></a><a href="#settings" aria-label="Settings"><Settings/></a></nav><span className="avatar">HS</span></aside>
  <aside className="catalog" id="contracts">
   <div className="project"><span>NS</span><div><b>Northstar API</b><small>orders-service</small></div><ChevronDown/></div>
   <button className="branch"><GitBranch/>feature/order-v2<ChevronDown/></button>
   <label className="search"><Search/><input value={query} onChange={e=>setQuery(e.target.value)} placeholder="Search endpoints"/></label>
   <div className="catalog-head"><span>Endpoints</span><button><Plus/></button></div>
   <div className="endpoints">{visible.map(e=><button className={selected.path===e.path?"endpoint selected":"endpoint"} onClick={()=>setSelected(e)} key={e.method+e.path}><span className={e.method.toLowerCase()}>{e.method}</span><div><b>{e.path}</b><small>{e.label}</small></div><i className={e.status}>{e.changes}</i></button>)}</div>
   <div className="catalog-foot"><span><ShieldCheck/>OpenAPI 3.1</span><small>Synced 2m ago</small></div>
  </aside>
  <section className="workspace">
   <header><div><span className={selected.method.toLowerCase()}>{selected.method}</span><div><h1>{selected.path}</h1><p>{selected.label}</p></div></div><div><button className="secondary"><Clock3/>History</button><button className="primary"><GitCompare/>Open review</button></div></header>
   <div className="release-bar"><div><span className="release-status"><X/>2 breaking changes</span><p>This contract cannot merge until consumers acknowledge the required field.</p></div><button>View affected consumers <ArrowRight/></button></div>
   <Tabs defaultValue="compare" className="tabs">
    <TabsList variant="line" className="tab-list"><TabsTrigger value="compare"><GitCompare/>Schema diff</TabsTrigger><TabsTrigger value="request"><Play/>Request lab</TabsTrigger><TabsTrigger value="impact"><ShieldCheck/>Consumer impact</TabsTrigger></TabsList>
    <TabsContent value="compare"><div className="compare-layout">
     <section className="diff"><div className="diff-head"><div><span>Current</span><b>main · v1.8.2</b></div><div><span>Proposed</span><b>feature/order-v2</b></div></div>
      <div className="editors"><div className="editor">{currentLines.map((l,i)=><div className={i===2||i===4||i===6||i===7?"line removed":"line"} key={l[0]}><span>{l[0]}</span><code>{l[1]}</code></div>)}</div><div className="editor">{proposedLines.map((l,i)=><div className={i===2||i===4||i===5||i===6||i===7?"line added":"line"} key={l[0]}><span>{l[0]}</span><code>{l[1]}</code></div>)}</div></div>
     </section>
     <aside className="findings"><div className="find-head"><div><span>Review findings</span><b>{issues.length}</b></div><button><Code2/>JSON</button></div>
      {issues.map((issue)=><article key={issue.title} className={issue.kind}><span>{issue.kind==="breaking"?<AlertTriangle/>:<Check/>}</span><div><small>{issue.kind==="breaking"?"BREAKING":"NON-BREAKING"} · {issue.line}</small><h2>{issue.title}</h2><p>{issue.detail}</p><button>Inspect change <ChevronRight/></button></div></article>)}
      <section className="consumer"><span>Affected consumer</span><div><b>checkout-web</b><small>Last call 47 seconds ago</small></div><p>Reads the order schema through generated TypeScript types.</p><button>Notify owner</button></section>
     </aside>
    </div></TabsContent>
    <TabsContent value="request"><div className="request-lab" id="terminal"><section><div className="request-head"><span>Request body</span><button onClick={copy}>{copied?<Check/>:<Copy/>} {copied?"Copied":"Copy"}</button></div><textarea value={body} onChange={e=>setBody(e.target.value)} spellCheck={false}/><button className="send" onClick={send}><Play/>Send request</button></section><section className="response"><div><span>Response</span>{sent&&<b>201 CREATED · 184ms</b>}</div>{sent?<pre>{'{\n  "id": "ord_9812",\n  "status": "confirmed",\n  "currency": "EUR"\n}'}</pre>:<div className="response-empty"><Play/><p>Send the request to inspect the response.</p></div>}</section></div></TabsContent>
    <TabsContent value="impact"><div className="impact"><ShieldCheck/><h2>1 consumer requires attention</h2><p>checkout-web generated types will fail because currency is newly required.</p><div><span>checkout-web</span><b>Owner: Payments UI</b><small>Last deployed 3 hours ago</small></div></div></TabsContent>
   </Tabs>
  </section>
 </main>
}
