// Runs each query from the fake supabase client against real Postgres, as the signed-in user (RLS + triggers apply)
const {Pool,types}=require('pg');types.setTypeParser(1082,v=>v);
const PK={machines:'machine_no',app_users:'email',requests:'id',documents:'id'};
const id=s=>{if(!/^[a-z_]+$/.test(s))throw new Error('bad ident '+s);return '"'+s+'"'};
module.exports=async function(){
  const pool=new Pool({...require('./env.js').pg,max:8});
  return async b=>{
    const c=await pool.connect();
    try{
      await c.query('begin');
      await c.query("select set_config('request.jwt.claims',$1,true), set_config('request.headers',$2,true)",[b.email?JSON.stringify({email:b.email}):'',JSON.stringify(b.headers||{})]);
      await c.query('set local role '+(b.email?'authenticated':'anon'));
      const vals=[];const where=b.f&&b.f.length?' where '+b.f.map(([k,v])=>{vals.push(String(v));return id(k)+'::text=$'+vals.length}).join(' and '):'';
      let sql,rows;
      if(b.op==='rpc'){rows=(await c.query('select public.'+id(b.t)+'() as v')).rows;await c.query('commit');return {data:rows[0].v,error:null}}
      const T='public.'+id(b.t);
      if(b.op==='select'){sql=`select * from ${T}${where}`+(b.order.length?' order by '+b.order.map(([k,a])=>id(k)+(a?' asc':' desc')).join(','):'');}
      else if(b.op==='delete'){sql=`delete from ${T}${where} returning *`;}
      else{
        const arr=[].concat(b.payload);const cols=Object.keys(arr[0]);const cl=cols.map(id).join(',');
        vals.push(JSON.stringify(b.op==='update'?arr[0]:arr));const p='$'+vals.length;
        if(b.op==='update')sql=`update ${T} set (${cl}) = (select ${cl} from json_populate_record(null::${T}, ${p}::json))${where} returning *`;
        else sql=`insert into ${T} (${cl}) select ${cl} from json_populate_recordset(null::${T}, ${p}::json)`+(b.op==='upsert'?` on conflict (${id(PK[b.t])}) do update set (${cl}) = (select ${cols.map(k=>'excluded.'+id(k)).join(',')})`:'')+' returning *';
      }
      rows=(await c.query(sql,vals)).rows;
      await c.query('commit');
      if(b.op==='update'&&!rows.length&&b.f.length) return {data:null,error:null,_noop:true};
      return {data:b.single?rows[0]||null:rows,error:null};
    }catch(e){await c.query('rollback').catch(()=>{});return {data:null,error:{message:e.message}}}
    finally{c.release()}
  };
};
