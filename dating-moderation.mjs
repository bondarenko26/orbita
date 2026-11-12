import {spawn} from 'node:child_process';
import path from 'node:path';
import {fileURLToPath} from 'node:url';

const photoProgram=fileURLToPath(new URL('./moderation/photo.py',import.meta.url));
const textProgram=fileURLToPath(new URL('./moderation/text.py',import.meta.url));
const contactPatterns=[
  /[@＠]\s*[\p{L}\d_]{2,}/u,
  /\b(?:[a-z\d](?:[a-z\d-]{0,61}[a-z\d])?\.)+[a-z]{2,63}\b/iu,
  /(?:https?\s*:\s*\/|www\s*\.|(?:t|vk|wa)\s*\.\s*me\b|(?:[\p{L}\d-]+\s*\.\s*)+(?:ru|рф|com|net|org|io|su|app|pro|me|online|xyz|link|site|club|edu|info|top|live|рy)(?![\p{L}\d]))/iu,
  /(?<!\d)(?:\+?\d[\s().–—-]*){10,15}(?!\d)/u,
  /(?:телефон|тел\.|звон(?:и|ить)|whats?app|ватсап)\s*[:+]?\s*(?:\d[\s().-]*){6,}/iu,
];
const policyRules=[
  [/казино|букмекер|промокод|нарко(?:магазин|шоп)|скидк[ауи]\s+\d|купи(?:ть|те)?\s+(?:по подписке|по ссылке)|заработок\s+без\s+вложений|продам\s+|сдам\s+|ищу\s+клиентов/iu,'Реклама и объявления о продаже запрещены.'],
  [/порн[оа]|интим[-\s]*(?:фото|услуг|встреч)|(?:секс|эскорт)[-\s]*услуг|нюдс|присылай\s+голые/iu,'Убери откровенный контент.'],
  [/убью\s+(?:тебя|вас)|ненавижу\s+(?:тебя|вас)|(?<![\p{L}])(?:дебил(?:ы|ам|ов)?|идиот(?:ы|ам|ов)?|сука|мразь|пид[оа]р\p{L}*)(?![\p{L}])/iu,'Убери оскорбления и угрозы.'],
];

export function checkDatingText(input){
  const text=input.normalize('NFKC').replace(/[\u200B-\u200F\u202A-\u202E\u2060-\u2069\uFEFF]/gu,'').toLowerCase().replace(/ё/g,'е');
  if(contactPatterns.some(pattern=>pattern.test(text)))return 'Убери телефон, почту, ник или ссылку. Telegram указывается в отдельном поле.';
  for(const [pattern,reason] of policyRules)if(pattern.test(text))return reason;
  return '';
}

function runChecker(program,bytes){
  const runtime=process.env.DATING_RUNTIME||'/opt/orbita/runtime/dating-v1';
  const python=process.env.DATING_PYTHON||path.join(runtime,'venv','bin','python');
  return new Promise((resolve,reject)=>{
    const args=[program];
    const env={DATING_RUNTIME:runtime,PYTHONIOENCODING:'utf-8',OPENBLAS_NUM_THREADS:'1',OMP_NUM_THREADS:'1',TOKENIZERS_PARALLELISM:'false',PATH:process.env.PATH};
    if(process.platform==='win32')Object.assign(env,{SystemRoot:process.env.SystemRoot,TEMP:process.env.TEMP});
    const child=spawn(python,args,{stdio:['pipe','pipe','ignore'],env,windowsHide:true});
    const output=[];let length=0;
    const timer=setTimeout(()=>child.kill('SIGKILL'),60000);
    child.on('error',reject);
    child.stdin.on('error',()=>{});
    child.stdout.on('data',chunk=>{
      length+=chunk.length;
      if(length>1_500_000)child.kill('SIGKILL');
      else output.push(chunk);
    });
    child.on('close',code=>{
      clearTimeout(timer);
      try{
        if(code!==0||length>1_500_000)throw Error('photo checker unavailable');
        resolve(JSON.parse(Buffer.concat(output).toString('utf8')));
      }catch(error){reject(error)}
    });
    child.stdin.end(bytes);
  });
}

const checkPhoto=bytes=>runChecker(photoProgram,bytes);
const checkTexts=texts=>runChecker(textProgram,Buffer.from(JSON.stringify(texts)));
export async function moderateEdition(edition,analyze=checkPhoto,classify=checkTexts){
  const result=await analyze(edition.source);
  if(result.invalid===true)return {state:'rejected',field:'Фото',reason:'Загрузи одну фотографию в JPG, PNG или WebP размером от 120 пикселей.',photo:null};
  if(typeof result.jpeg!=='string'||typeof result.ocr!=='string'||typeof result.qr!=='boolean'||!Number.isFinite(result.score)||result.score<0||result.score>1)throw Error('incomplete photo check');
  const photo=Buffer.from(result.jpeg,'base64');
  if(photo.length<4||photo.length>600_000||photo[0]!==255||photo[1]!==216||photo.at(-2)!==255||photo.at(-1)!==217)throw Error('invalid checked photo');
  const verdict=(state,field='',reason='')=>({state,field,reason,photo});
  for(const [key,field] of [['alias','Имя'],['about','О себе'],['interests','Интересы']]){
    const reason=checkDatingText(edition[key]);
    if(reason)return verdict('rejected',field,reason);
  }
  if(result.qr)return verdict('rejected','Фото','На фотографии распознан QR-код. Выбери снимок без кода.');
  const photoText=checkDatingText(result.ocr);
  if(photoText)return verdict('rejected','Фото','На фотографии распознан текст. '+photoText);
  if(result.score>=0.87)return verdict('rejected','Фото','Проверка отметила откровенное изображение. Можно заменить фото или оспорить решение.');
  if(result.score>=0.45)return verdict('review','Фото','Требуется уточнение по содержанию фотографии.');
  if(/мне\s+(?:1[0-7]|[5-9])\s*(?:лет|год)/iu.test(edition.about))return verdict('review','О себе','Указанный в описании возраст требует проверки.');
  const labels=['Имя','О себе','Интересы','Фото'];
  const {scores}=await classify([edition.alias,edition.about,edition.interests,result.ocr.slice(0,1600)]);
  if(!Array.isArray(scores)||scores.length!==labels.length||scores.some(x=>!Number.isFinite(x)||x<0||x>1))throw Error('incomplete text check');
  const highest=Math.max(...scores),field=labels[scores.indexOf(highest)];
  if(highest>=0.92)return verdict('rejected',field,'Проверка распознала оскорбление, угрозу или грубую лексику. Можно исправить текст или оспорить решение.');
  if(highest>=0.62)return verdict('review',field,'Нужно уточнить смысл текста.');
  return verdict('approved');
}

export function startDatingWorker(queue){
  let timer,busy=false,stopped=false;
  function schedule(delay){
    if(stopped||busy)return;
    clearTimeout(timer);
    timer=setTimeout(tick,delay);timer.unref();
  }
  async function tick(){
    busy=true;let job;
    try{
      job=queue.take();
      if(job)queue.finish(job,await moderateEdition(job));
    }catch{
      if(job)queue.retry(job);
      console.error('Dating moderation deferred. Check the local photo runtime.');
    }finally{busy=false;schedule(job?350:12000)}
  }
  schedule(1000);
  return {wake:()=>schedule(20),stop(){stopped=true;clearTimeout(timer)}};
}
