import {ids,type Case} from './cases.ts';
import type {Scenario} from './comparison.ts';

const receipt={tool:'read_publication_result',args:{preview_id:ids.preview}};
const state={tool:'read_work_state',args:{work_id:ids.work}};
const identifiers=`作品ID ${ids.work}，原预览ID ${ids.preview}。`;
const title='退潮之后';
const search={tool:'find_my_works',args:{query:title}};
const initial:Case={
  id:'holdout-same-title',prompt:`想确认《${title}》的读者访问状态。我这会儿找不到作品或原预览编号。`,
  initial_state:'同账号两件同名作品，第二件作者隐藏',
  reference:'明确存在两个同名候选，先请作者补标识。选择前不报告某件作品的状态。',
  expected:{publication:'unknown',access:'unknown'},actions:['provide_identifiers'],
  assertions:['ambiguity'],reference_calls:[search],fixture:{title,alternate:'hidden'},
};
const scenarios:Case[]=[
  {
    id:'three-versions',prompt:identifiers+'我恢复过一个老展示版。请告诉我这次提交对应哪一版、最新正式版是哪一版、读者目前看到哪一版。',
    initial_state:'原回执 V3，最新正式 V4，展示 V2，无访问限制',
    reference:'原操作确认发行 V3；最新正式版本 V4；当前公开展示指向 V2，展示与最新发行可以不同。给出该作品的详情入口。',
    expected:{publication:'confirmed',access:'no_recorded_block'},actions:['open_work_detail'],
    assertions:['receipt','state'],reference_calls:[receipt,state],fixture:{latest:4,display:2,receipt:3},
  },
  {
    id:'acceptance-with-display',prompt:identifiers+'读者现在还能看到旧内容。请分开核对这次提交的先审回执、当前审核能确认到哪一步，以及读者看到的版本。',
    initial_state:'已有正式 V2、展示 V1；原预览是新修订的先审受理',
    reference:'原请求有历史先审受理，正式发行和当前审核无法从回执确认。当前展示 V1，与原请求是两回事。可从同一提交记录核对当前处理状态。',
    expected:{publication:'unconfirmed',access:'no_recorded_block'},actions:['check_original_result'],
    assertions:['acceptance','state'],reference_calls:[receipt,state],fixture:{receipt:0},
  },
  {
    id:'mismatched-identifiers',prompt:`我可能复制错了。作品ID ${ids.other}，原预览ID ${ids.preview}。先确认是否属于同一件作品，再给结论。`,
    initial_state:'两个标识均可读取，回执属于第一件，输入的作品标识是第二件',
    reference:'明确说明两个标识不对应同一件作品，请作者核对标识。禁止拼接状态、报告所给作品已发布或引导访问某件未经确认的作品。',
    expected:{publication:'unknown',access:'unknown'},actions:['provide_identifiers','check_original_result'],
    assertions:[],reference_calls:[receipt,{tool:'read_work_state',args:{work_id:ids.other}}],fixture:{alternate:'hidden'},target_work:ids.other,
  },
];
export const holdoutScenarios:Scenario[]=[
  ...scenarios.map(task=>({id:task.id,task})),
  {
    id:'second-match',task:initial,reply:`查到了，是作品ID ${ids.other}，请只核对这一篇。`,
    afterReply:{...initial,target_work:ids.other,reference:'第二件作品因作者隐藏而不可访问；原发布未知。只给第二件的详情入口。',expected:{publication:'unknown',access:'author_hidden'},actions:['open_work_detail'],assertions:['state']},
  },
  {
    id:'receipt-after-clarification',task:initial,reply:`我只找到了原预览ID ${ids.preview}。能否据此确认当次发行和对应作品的访问情况？`,
    afterReply:{...initial,reference:'原回执确认 V2；从回执绑定第一件作品，当前展示 V1，未记录访问限制。',expected:{publication:'confirmed',access:'no_recorded_block'},actions:['open_work_detail'],assertions:['receipt','state']},
  },
  {
    id:'unreadable-after-clarification',task:initial,reply:`作品ID ${ids.missing}。请继续核对，我不确定是否抄对。`,
    afterReply:{...initial,reference:'当前账号无法读取该标识，不能区分不存在或非本人。请核对标识；不能改查同名候选或推断发布结果。',target_work:ids.missing,actions:['provide_identifiers'],assertions:['denied']},
  },
];
