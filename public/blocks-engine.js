export const SIDE = 8;

// Each pattern keeps its orientation throughout a hand.
const patterns = [
  ['1'], ['11'], ['1','1'], ['111'], ['1','1','1'],
  ['1111'], ['1','1','1','1'], ['11111'], ['1','1','1','1','1'],
  ['11','11'], ['111','111'], ['11','11','11'], ['111','111','111'],
  ['10','11'], ['01','11'], ['11','10'], ['11','01'],
  ['10','10','11'], ['111','100'], ['01','01','11'],
  ['111','010'], ['010','111'], ['10','11','10'],
  ['011','110'], ['110','011']
];

export const shapes = patterns.map(rows => {
  const cells = [];
  rows.forEach((row, y) => [...row].forEach((value, x) => {
    if (value === '1') cells.push([x,y]);
  }));
  return {w:rows[0].length, h:rows.length, cells};
});

export function fits(board, shape, x, y) {
  if (!Number.isInteger(x) || !Number.isInteger(y) || x < 0 || y < 0 ||
      x + shape.w > SIDE || y + shape.h > SIDE) return false;
  return shape.cells.every(([dx,dy]) => !board[(y+dy)*SIDE+x+dx]);
}

function hasSpace(board, shape) {
  for (let y=0; y<=SIDE-shape.h; y++) {
    for (let x=0; x<=SIDE-shape.w; x++) if (fits(board,shape,x,y)) return true;
  }
  return false;
}

function deal(board, random=Math.random) {
  const pool = shapes.map((_,id)=>id);
  // Include a playable small or medium piece when possible. Draw the other two freely.
  const helpers = pool.filter(id=>shapes[id].cells.length<=4 && hasSpace(board,shapes[id]));
  const pick = list => list[Math.floor(random()*list.length)];
  const ids = [];
  while (ids.length < 3) {
    ids.push(pick(!ids.length && helpers.length ? helpers : pool.filter(id=>!ids.includes(id))));
  }
  const offset = Math.floor(random()*3);
  return ids.map((_,i)=>({id:ids[(i+offset)%3], color:1+Math.floor(random()*6)}));
}

export function newRound(random=Math.random) {
  const board=Array(SIDE*SIDE).fill(0);
  return {board, hand:deal(board,random), score:0, combo:0};
}

export function isOver(state) {
  return !state.hand.some(piece=>piece && hasSpace(state.board,shapes[piece.id]));
}

export function place(state, slot, x, y, random=Math.random) {
  const piece=state.hand[slot];
  if (!piece || !fits(state.board,shapes[piece.id],x,y)) return null;
  const board=state.board.slice();
  const placed=shapes[piece.id].cells.map(([dx,dy])=>(y+dy)*SIDE+x+dx);
  placed.forEach(index=>board[index]=piece.color);
  const cleared=new Set();
  let lines=0;
  for (let i=0;i<SIDE;i++) {
    const row=Array.from({length:SIDE},(_,j)=>i*SIDE+j);
    const col=Array.from({length:SIDE},(_,j)=>j*SIDE+i);
    for (const indices of [row,col]) {
      if (indices.every(index=>board[index])) {
        lines++;
        indices.forEach(index=>cleared.add(index));
      }
    }
  }
  const removed=Array.from(cleared,index=>({index,color:board[index]}));
  cleared.forEach(index=>board[index]=0);
  const combo=lines ? state.combo+1 : 0;
  const points=placed.length + 10*lines + 10*Math.max(0,lines-1) + 5*Math.max(0,combo-1);
  const hand=state.hand.slice();
  hand[slot]=null;
  const refill=hand.every(p=>!p);
  const next={board, hand:refill ? deal(board,random) : hand, score:state.score+points, combo};
  return {next, placed, removed, lines, points, refill, perfect:lines>0 && board.every(cell=>!cell)};
}

const natural = n => Number.isSafeInteger(n) && n>=0;
export function validRound(round) {
  return round && Array.isArray(round.board) && round.board.length===64 &&
    round.board.every(n=>natural(n)&&n<=6) && natural(round.score) && natural(round.combo) &&
    Array.isArray(round.hand) && round.hand.length===3 && round.hand.some(Boolean) &&
    round.hand.every(p=>p===null || (p && natural(p.id) && p.id<shapes.length &&
      Number.isInteger(p.color) && p.color>=1 && p.color<=6));
}
