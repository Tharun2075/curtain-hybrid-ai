// Firestore rules check (needs the emulator): npm run test:rules
// Copyright 2026 Agri Group. Licensed under the Apache License, Version 2.0.
import {initializeTestEnvironment, assertFails, assertSucceeds} from '@firebase/rules-unit-testing';
import {readFileSync} from 'fs';
import {doc,setDoc,getDoc,updateDoc,deleteDoc,getDocs,collection} from 'firebase/firestore';
const env=await initializeTestEnvironment({projectId:'demo-curtain',firestore:{rules:readFileSync('firestore.rules','utf8'),host:'127.0.0.1',port:8188}});
const a=env.authenticatedContext('uidA').firestore(), b=env.authenticatedContext('uidB').firestore(), anon=env.unauthenticatedContext().firestore();
const run={task:'reply',threadId:'t1',maskedInput:'Hi [NAME_1]',maskedOutput:'Dear [NAME_1]',route:'cloud',maskCount:1,createdAt:1};
let ok=0,n=0; const T=async(name,p)=>{n++;try{await p;ok++;console.log('PASS',name)}catch(e){console.log('FAIL',name,e.message.slice(0,100))}};
await T('A creates own run',assertSucceeds(setDoc(doc(a,'users/uidA/runs/r1'),run)));
await T('A reads own run',assertSucceeds(getDoc(doc(a,'users/uidA/runs/r1'))));
await T('B cannot read A run',assertFails(getDoc(doc(b,'users/uidA/runs/r1'))));
await T('B cannot list A runs',assertFails(getDocs(collection(b,'users/uidA/runs'))));
await T('B cannot write into A path',assertFails(setDoc(doc(b,'users/uidA/runs/r2'),run)));
await T('anon(no auth) cannot read',assertFails(getDoc(doc(anon,'users/uidA/runs/r1'))));
await T('A cannot update',assertFails(updateDoc(doc(a,'users/uidA/runs/r1'),{route:'x'})));
await T('A cannot delete',assertFails(deleteDoc(doc(a,'users/uidA/runs/r1'))));
await T('extra field (restoreMap) rejected',assertFails(setDoc(doc(a,'users/uidA/runs/r3'),{...run,restoreMap:{x:'y'}})));
await T('oversize text rejected',assertFails(setDoc(doc(a,'users/uidA/runs/r4'),{...run,maskedInput:'x'.repeat(20000)})));
await T('other collection denied',assertFails(setDoc(doc(a,'misc/x'),{a:1})));
console.log(`${ok}/${n}`); await env.cleanup(); process.exit(ok===n?0:1);
