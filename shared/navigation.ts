export type StudyTarget = { tab:"home"|"library"|"questions"|"plan"|"practice";courseId?:string;id?:string;date?:string;topic?:string;wrongOnly?:boolean;focus?:string };
export type DueItem = {key:string;title:string;courseId?:string;date:string;time:string;overdue:boolean;target:StudyTarget};
