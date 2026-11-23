import {Children, isValidElement, useRef, type ReactNode} from 'react';

/** Keep the native file dialog and existing change handlers, with a keyboard-accessible trigger. */
export function UploadButton({children,className=''}:{children:ReactNode;className?:string}) {
  const host=useRef<HTMLSpanElement>(null);
  const parts=Children.toArray(children);
  const isInput=(part:ReactNode)=>isValidElement(part)&&part.type==='input';
  return <span className="file-upload" ref={host}>
    <button type="button" className={'button upload-trigger '+className}
      onClick={()=>host.current?.querySelector<HTMLInputElement>('input[type="file"]')?.click()}>
      {parts.filter(part=>!isInput(part))}
    </button>
    {parts.filter(isInput)}
  </span>;
}
