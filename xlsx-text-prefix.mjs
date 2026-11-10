import JSZip from 'jszip';

// ExcelJS does not serialize quotePrefix. Add it to the generated workbook only;
// never modify or execute user-supplied workbook content here.
export async function addTextPrefixes(buffer){
 const zip=await JSZip.loadAsync(buffer);
 let styles=await zip.file('xl/styles.xml').async('string');
 const match=styles.match(/<cellXfs\b[^>]*>([\s\S]*?)<\/cellXfs>/);
 if(!match)throw Error('Missing generated workbook styles');
 const formats=match[1].match(/<xf\b[^>]*?(?:\/>|>[\s\S]*?<\/xf>)/g)||[],originalCount=formats.length,mapped=new Map();
 let sheet=await zip.file('xl/worksheets/sheet1.xml').async('string'),count=0;
 sheet=sheet.replace(/<c\b[^>]*\br="([CF])(\d+)"[^>]*>/g,(tag,column,row)=>{
  if(Number(row)<2||Number(row)>201)return tag;
  const old=Number(tag.match(/\bs="(\d+)"/)?.[1]||0);
  if(!formats[old]||old>=originalCount)throw Error('Invalid generated cell style');
  if(!mapped.has(old)){mapped.set(old,formats.length);formats.push(formats[old].replace(/\squotePrefix="[^"]*"/g,'').replace('<xf','<xf quotePrefix="1"'))}
  count++;const id=mapped.get(old);return /\bs="\d+"/.test(tag)?tag.replace(/\bs="\d+"/,'s="'+id+'"'):tag.replace('<c','<c s="'+id+'"');
 });
 if(count!==400)throw Error('Expected 200 text input cells in both C and F');
 styles=styles.replace(match[0],'<cellXfs count="'+formats.length+'">'+formats.join('')+'</cellXfs>');
 zip.file('xl/styles.xml',styles);zip.file('xl/worksheets/sheet1.xml',sheet);
 return zip.generateAsync({type:'nodebuffer',compression:'DEFLATE'});
}
