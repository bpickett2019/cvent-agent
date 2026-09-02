import assert from "node:assert/strict";
import { promoteWorkspaceAuthentication } from "./web/lib/workspace-auth-promotion";

const source = { id:"source", name:"Source", ownerJobId:"job", eventId:"e712e34c-6117-4d13-bf4c-8ed54cf2b495", access:"readOnly", controller:"agent", status:"ready", createdAt:"", updatedAt:"", containerId:"c", providerSessionId:"session-source", apiUrl:"http://steel-source", viewerUrl:"http://viewer", error:null, activity:[] } as const;
const sibling = { ...source, id:"sibling", providerSessionId:"session-sibling", apiUrl:"http://steel-sibling" } as any;
const activities:string[]=[]; const refreshed:string[]=[]; let saved:any;
const manager:any={get:async(id:string)=>id==='source'?source:null,list:async()=>[source,sibling],recordActivity:async(id:string,a:any)=>{activities.push(`${id}:${a.type}`);return source;},refreshAuthentication:async(id:string)=>{refreshed.push(id);return sibling;}};
const fetchImpl=async(url:string)=>{
 if(url.endsWith('/live-details')) return new Response(JSON.stringify({pages:[{url:`https://app.cvent.com/events/home?evtstub=${source.eventId}`,title:'Event'}]}),{status:200});
 if(url.endsWith('/context')) return new Response(JSON.stringify({cookies:[{name:'opaque',value:'secret'}],localStorage:{'https://app.cvent.com':{state:'opaque'}},sessionStorage:{'https://app.cvent.com':{state:'opaque'}}}),{status:200});
 throw new Error(`unexpected ${url}`);
};
const result=await promoteWorkspaceAuthentication({workspaceId:'source',manager,sessionPath:'/private/session.json',fetchImpl:fetchImpl as typeof fetch,writeContext:async(_path,value)=>{saved=value;}});
assert.equal(result.sourceWorkspaceId,'source');
assert.deepEqual(result.refreshed,[{id:'sibling',status:'refreshed'}]);
assert.equal(saved.cookies.length,1);
assert.deepEqual(refreshed,['sibling']);
assert.ok(activities.includes('source:authentication_promoted'));
await assert.rejects(promoteWorkspaceAuthentication({workspaceId:'source',manager,sessionPath:'/x',fetchImpl:(async()=>new Response(JSON.stringify({pages:[{url:'https://app.cvent.com/Subscribers/Login.aspx'}]}),{status:200})) as typeof fetch,writeContext:async()=>{}}),/not authenticated/i);
console.log('workspace auth promotion smoke passed');
