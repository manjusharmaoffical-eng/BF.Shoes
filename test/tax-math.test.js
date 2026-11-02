import test from "node:test";
import assert from "node:assert/strict";
import { calculateIndiaGst } from "../src/tax-math.js";

test("exclusive intra-state GST splits tax into CGST and SGST",()=>{
  const r=calculateIndiaGst({subtotalCents:10000,deliveryFeeCents:500,taxRateBps:500,treatment:"INTRA_STATE",pricesTaxInclusive:false,deliveryFeeTaxable:true});
  assert.deepEqual(r,{taxableBaseCents:10500,taxCents:525,cgstCents:262,sgstCents:263,igstCents:0,totalCents:11025});
});

test("inclusive prices extract GST without increasing the displayed payable total",()=>{
  const r=calculateIndiaGst({subtotalCents:10500,deliveryFeeCents:500,taxRateBps:500,treatment:"INTER_STATE",pricesTaxInclusive:true,deliveryFeeTaxable:false});
  assert.deepEqual(r,{taxableBaseCents:10500,taxCents:500,cgstCents:0,sgstCents:0,igstCents:500,totalCents:11000});
});

test("zero-rated and exempt treatments do not add GST",()=>{
  for(const treatment of ["ZERO_RATED","EXEMPT"]){
    const r=calculateIndiaGst({subtotalCents:10000,deliveryFeeCents:500,taxRateBps:1800,treatment,pricesTaxInclusive:false,deliveryFeeTaxable:false});
    assert.equal(r.taxCents,0);assert.equal(r.totalCents,10500);
  }
});

test("invalid GST configuration is rejected",()=>{
  assert.throws(()=>calculateIndiaGst({subtotalCents:10000,deliveryFeeCents:0,taxRateBps:12000,treatment:"INTRA_STATE",pricesTaxInclusive:false,deliveryFeeTaxable:false}));
  assert.throws(()=>calculateIndiaGst({subtotalCents:10000,deliveryFeeCents:0,taxRateBps:500,treatment:"INTRA_STATE",pricesTaxInclusive:"yes",deliveryFeeTaxable:false}));
});
