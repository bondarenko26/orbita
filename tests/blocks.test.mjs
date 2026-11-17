import {test} from 'node:test';
import assert from 'node:assert/strict';
import {newRound,place,isOver,validRound,shapes} from '../public/blocks-engine.js';

test('crossing lines clear together, score once per placed block and streak resets on a quiet move',()=>{
 const state=newRound();
 for(let i=1;i<8;i++){state.board[i]=1;state.board[i*8]=2;}
 state.hand=[{id:0,color:5},{id:0,color:4},{id:9,color:3}];state.combo=1;
 const before=structuredClone(state);
 for(const [x,y] of [[-1,0],[0,8],[1,0]])assert.equal(place(state,0,x,y),null);
 const move=place(state,0,0,0);
 assert.deepEqual(state,before);
 assert.equal(move.lines,2);assert.equal(move.removed.length,15);
 assert.equal(move.points,1+20+10+5);assert.ok(move.perfect);
 assert.equal(move.next.combo,2);assert.equal(move.next.hand[0],null);
 const quiet=place(move.next,1,7,7);assert.equal(quiet.next.combo,0);
 const refill=place(quiet.next,2,0,0);assert.ok(refill.refill);
 assert.ok(validRound(refill.next));assert.equal(new Set(refill.next.hand.map(p=>p.id)).size,3);
});

test('all remaining pieces determine game over, and shape holes can surround occupied cells',()=>{
 const state=newRound();state.board.fill(1);state.board[63]=0;
 state.hand=[null,{id:9,color:1},{id:0,color:1}];assert.equal(isOver(state),false);
 state.hand[2]=null;assert.equal(isOver(state),true);
 state.board.fill(0);state.board[1]=1;state.hand[0]={id:13,color:2};
 assert.equal(shapes[13].cells.length,3);assert.ok(place(state,0,0,0));
 assert.equal(place(state,0,7,7),null);
 assert.equal(validRound({...state,hand:[{id:900,color:1},null,null]}),false);
});
