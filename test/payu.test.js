import test from "node:test";
import assert from "node:assert/strict";
import crypto from "node:crypto";
import { payuConfigured, payuPaymentUrl, payuRequestHash, payuResponseHash, safeHashEqual, publicBaseUrl } from "../src/payu.js";

const sha = value => crypto.createHash("sha512").update(value,"utf8").digest("hex");

test("PayU request hash uses all UDF fields and the required trailing empty fields",()=>{
  const fields={key:"merchant",txnid:"BF123",amount:"100.00",productinfo:"BF SHOES",firstname:"Asha",email:"buyer@example.com",udf1:"order-1",udf2:"uuid",udf3:"",udf4:"",udf5:""};
  const expected=sha(["merchant","BF123","100.00","BF SHOES","Asha","buyer@example.com","order-1","uuid",...Array(8).fill(""),"salt"].join("|"));
  assert.equal(payuRequestHash(fields,"salt"),expected);
});

test("PayU response hash validates the reverse field order",()=>{
  const fields={status:"success",udf1:"order-1",udf2:"uuid",udf3:"",udf4:"",udf5:"",email:"buyer@example.com",firstname:"Asha",productinfo:"BF SHOES",amount:"100.00",txnid:"BF123",key:"merchant"};
  const expected=sha(["salt","success",...Array(8).fill(""),"uuid","order-1","buyer@example.com","Asha","BF SHOES","100.00","BF123","merchant"].join("|"));
  assert.equal(payuResponseHash(fields,"salt"),expected);
});

test("PayU response hash uses timing-safe comparison and rejects malformed values",()=>{
  const digest=sha("test");
  assert.equal(safeHashEqual(digest,digest),true);
  assert.equal(safeHashEqual(digest,digest.toUpperCase()),true);
  assert.equal(safeHashEqual(digest,"bad"),false);
});

test("PayU checkout stays disabled until explicit enablement, credentials and HTTPS base URL exist",()=>{
  const old={...process.env};
  try{
    delete process.env.PAYU_ENABLED;delete process.env.PAYU_MERCHANT_KEY;delete process.env.PAYU_MERCHANT_SALT;delete process.env.PUBLIC_BASE_URL;
    assert.equal(payuConfigured(),false);
    process.env.PAYU_ENABLED="true";process.env.PAYU_MERCHANT_KEY="key";process.env.PAYU_MERCHANT_SALT="salt";
    process.env.PUBLIC_BASE_URL="http://bf-shoes.vercel.app";
    assert.equal(payuConfigured(),false);
    process.env.PUBLIC_BASE_URL="https://bf-shoes.vercel.app/path";
    assert.equal(publicBaseUrl(),"https://bf-shoes.vercel.app");
    assert.equal(payuConfigured(),true);
    process.env.PAYU_ENV="production";
    assert.equal(payuPaymentUrl(),"https://secure.payu.in/_payment");
  }finally{
    for(const key of Object.keys(process.env))if(!(key in old))delete process.env[key];
    Object.assign(process.env,old);
  }
});
