export interface CommentEntry { id:string;work_id:string;author_id:string;nickname:string;root_id:string|null;reply_to:string|null;reply_name:string;content:string;sequence:number;revision:number;replies:number;can_delete:boolean;created_at:string;deleted:boolean;blocked:boolean;reason:string }
export interface CommentPage {items:CommentEntry[];next:number}
