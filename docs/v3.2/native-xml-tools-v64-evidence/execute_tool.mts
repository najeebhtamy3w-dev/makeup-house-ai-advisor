/** Real read-only tool execution. No invented observation or product identity. */
import {readFileSync}from'node:fs';
import {boot}from'../../../tests/helpers.ts';
import {seedKnowledge}from'../../../server/src/cp07/store.ts';
import {executeTool}from'../../../server/src/intelligence/tools.ts';
import {ToolCall,Plan,EMPTY_MEMORY}from'../../../server/src/intelligence/contracts.ts';
const input=JSON.parse(readFileSync(0,'utf8'));
const allowed=new Set(['get_system_capabilities','retrieve_scientific_evidence','retrieve_conversation_context']);
if(!allowed.has(input.name))throw Error('TOOL_NOT_ALLOWED');
const call=ToolCall.parse({name:input.name,query:input.query??'',product_ids:[]});
const t=await boot();try{seedKnowledge(t.db);const result=executeTool(t.db,call,Plan.parse({intent:input.name==='get_system_capabilities'?'capabilities':'consultation'}),EMPTY_MEMORY,input.question);console.log(JSON.stringify(result));}finally{await t.close();}
