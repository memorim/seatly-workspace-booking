export interface BookingFilters{limit?:number;offset?:number;search?:string;status?:string}
export function bookingPageOptions(params:URLSearchParams){
 const limit=Number(params.get('limit')||40),offset=Number(params.get('offset')||0),search=(params.get('search')||'').trim().slice(0,200),status=params.get('status')||'';
 if(!Number.isSafeInteger(limit)||limit<1||limit>100||!Number.isSafeInteger(offset)||offset<0||offset>1000000||(status&&!['pending','confirmed','cancelled','expired'].includes(status)))throw new RangeError('Некорректные параметры страницы');
 return{limit,offset,search,status};
}
