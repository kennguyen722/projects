import express from 'express';
import * as protoLoader from '@grpc/proto-loader';
import grpc from '@grpc/grpc-js';
import path from 'path';
import http from 'http';
import https from 'https';
import crypto from 'crypto';

const app = express();
app.use(express.json());

const DISABLE_VERIFY = (process.env.DISABLE_SIGNATURE_VERIFY === 'true');

const PROTO_PATH = path.resolve(process.cwd(), 'proto/user.proto');
const packageDef = protoLoader.loadSync(PROTO_PATH, {keepCase:true, longs:String, enums:String, defaults:true});
const userPkg = grpc.loadPackageDefinition(packageDef).idm.user.v1;
const targetHost = process.env.GRPC_USER_HOST || 'user-service';
const targetPort = process.env.GRPC_USER_PORT || '8083';
// Use explicit dns:/// scheme to ensure proper name resolution in containers
const grpcTarget = `dns:///` + `${targetHost}:${targetPort}`;
let client = new userPkg.UserService(grpcTarget, grpc.credentials.createInsecure());

export function setClient(mock){ client = mock; }

// Fetch JWKs from auth-service for RS256 verification
let publicKey; // cached KeyObject
async function fetchJwk(){
  return new Promise((resolve,reject)=>{
    const url = process.env.JWKS_URL || 'http://auth-service:8081/oauth/jwks';
    console.log('Fetching JWK from', url);
    const lib = url.startsWith('https')? https : http;
    lib.get(url, res => {
      let data=''; res.on('data',d=>data+=d); res.on('end',()=>{
        try {
          if(!data){ return reject(new Error('Empty JWKS response')); }
          const json = JSON.parse(data);
          const jwk = json.keys[0];
          // Build a KeyObject from JWK (lets Node handle encoding)
          publicKey = crypto.createPublicKey({ key: jwk, format: 'jwk' });
          resolve();
        } catch(e){ reject(e); }
      });
    }).on('error', reject);
  });
}

// (manual PEM conversion removed; using Node's JWK import)
// Only prefetch JWKS when verification is enabled
if(!DISABLE_VERIFY){
  await fetchJwk().catch(err=> console.error('Failed to fetch JWK', err));
}

// JWT scope check with lazy JWKS fetch
function authorize(requiredScope){
  return async (req,res,next)=>{
    const auth = req.headers.authorization;
    if(!auth){ return res.status(401).json({error:'missing_auth'}); }
    const token = auth.replace('Bearer ','');
    try {
      const parts = token.split('.');
      if(parts.length!==3) return res.status(401).json({error:'invalid_token'});
      const [headerB64,payloadB64,signatureB64] = parts;
      const header = JSON.parse(Buffer.from(headerB64,'base64url').toString('utf8'));
      const payload = JSON.parse(Buffer.from(payloadB64,'base64url').toString('utf8'));
      // basic exp check
      if(payload.exp && payload.exp < (Date.now()/1000)) return res.status(401).json({error:'token_expired'});
      if(!DISABLE_VERIFY){
        // verify signature (always refresh JWK in dev to avoid race)
        try { await fetchJwk(); } catch(e){ return res.status(500).json({error:'no_jwk'}); }
        const verify = crypto.createVerify('RSA-SHA256');
        verify.update(headerB64+"."+payloadB64);
        verify.end();
        let sigOk = verify.verify(publicKey, Buffer.from(signatureB64,'base64url'));
        if(!sigOk){
          // One-time retry: refetch JWK in case of rotation race
          try { await fetchJwk(); } catch(e) {}
          const v2 = crypto.createVerify('RSA-SHA256');
          v2.update(headerB64+"."+payloadB64);
          v2.end();
          sigOk = v2.verify(publicKey, Buffer.from(signatureB64,'base64url'));
        }
        if(!sigOk){
          console.error('JWT verify failed', { alg: header.alg, kid: header.kid });
          return res.status(401).json({error:'bad_signature'});
        }
      }
      const scopes = payload.scope?.split(' ')||[];
      if(!scopes.includes(requiredScope)) return res.status(403).json({error:'insufficient_scope'});
      req.user = payload.sub;
      next();
    } catch(e){ return res.status(401).json({error:'token_parse_error'}); }
  };
}

// SCIM list users
app.get('/scim/v2/Users', authorize('scim.read'), (req,res)=>{
  client.listUsers({page:1,pageSize:100}, (err, resp)=>{
    if(err) return res.status(500).json({error:err.message});
    res.json({Resources: resp.users.map(u=> toScim(u)), totalResults: resp.total});
  });
});

app.post('/scim/v2/Users', authorize('scim.write'), (req,res)=>{
  const scim = req.body;
  const user = { id:'', userName: scim.userName, givenName: scim.name?.givenName, familyName: scim.name?.familyName, emails: (scim.emails||[]).map(e=>e.value), active: true };
  client.createUser({user}, (err, resp)=>{
    if(err) return res.status(500).json({error:err.message});
    res.status(201).json(toScim(resp.user));
  });
});

app.get('/scim/v2/Users/:id', authorize('scim.read'), (req,res)=>{
  client.getUser({id:req.params.id}, (err, resp)=>{
    if(err) return res.status(404).json({error:'not_found'});
    res.json(toScim(resp.user));
  });
});

app.put('/scim/v2/Users/:id', authorize('scim.write'), (req,res)=>{
  const scim = req.body;
  const user = { id:req.params.id, userName: scim.userName, givenName: scim.name?.givenName, familyName: scim.name?.familyName, emails: (scim.emails||[]).map(e=>e.value), active: scim.active!==false };
  client.updateUser({user}, (err, resp)=>{
    if(err) return res.status(404).json({error:'not_found'});
    res.json(toScim(resp.user));
  });
});

app.delete('/scim/v2/Users/:id', authorize('scim.write'), (req,res)=>{
  client.deleteUser({id:req.params.id}, (err, resp)=>{
    if(err) return res.status(404).json({error:'not_found'});
    res.status(resp.deleted?204:404).send();
  });
});

function toScim(u){
  return {
    id: u.id,
    userName: u.userName,
    name: { givenName: u.givenName, familyName: u.familyName },
    emails: (u.emails||[]).map(e=>({value:e, primary:true})),
    active: u.active,
    schemas: ["urn:ietf:params:scim:schemas:core:2.0:User"]
  };
}

export { app };

const port = process.env.PORT || 8082;
if(process.env.NODE_ENV !== 'test' && !process.env.JEST_WORKER_ID){
  app.listen(port, ()=> console.log('SCIM service listening on '+port));
}
