import { useEffect, useState } from 'react';
import { Pressable, ScrollView, Text, TextInput, View, StyleSheet, Alert } from 'react-native';
import { router, useLocalSearchParams, usePreventRemove } from 'expo-router';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useSession } from '../auth/context';
import { apiMessage } from '../api/client';
import { ReportsAPI, type ContentReport } from './api';
import { theme as t } from '../theme';
export default function Reports() {
    const auth = useSession();
    const params = useLocalSearchParams<{
        work?: string;
        version?: string;
    }>();
    return <ReportsBody key={`${auth.generation}:${params.work}:${params.version}`} work={typeof params.work === 'string' ? params.work : ''} version={Number(params.version)}/>;
}
function ReportsBody({ work, version }: {
    work: string;
    version: number;
}) {
    const auth = useSession(), [reason, setReason] = useState(''), [items, setItems] = useState<ContentReport[]>([]), [next, setNext] = useState(0), [busy, setBusy] = useState(auth.phase === 'ready'), [error, setError] = useState(''), [selected, setSelected] = useState<ContentReport | null>(null), [sent, setSent] = useState(false);
    const current = () => auth.session.snapshot().generation === auth.generation;
    usePreventRemove(Boolean(reason) && !sent, ({ repeat }) => Alert.alert('离开举报页？', '尚未提交的说明将丢弃。已被服务端接收的举报可在我的举报中查询。', [{ text: '继续填写', style: 'cancel' }, { text: '离开', style: 'destructive', onPress: repeat }]));
    async function load(more = false) { if (busy || auth.phase !== 'ready')
        return; setBusy(true); setError(''); try {
        const out = await new ReportsAPI((path, options) => auth.session.authorized(path, options)).list(more ? next : 0);
        const latest=selected&&!more?await new ReportsAPI((path,options)=>auth.session.authorized(path,options)).detail(selected.id):null;
        if (current()) {
            setItems(old => more ? [...old, ...out.items] : out.items);
            setNext(out.next);
            if(latest)setSelected(latest);
        }
    }
    catch (e) {
        if (current())
            setError(apiMessage(e));
    }
    finally {
        if (current())
            setBusy(false);
    } }
    useEffect(() => {
        let alive = true;
        const gen = auth.generation, session = auth.session;
        if (auth.phase !== 'ready')
            return;
        void new ReportsAPI((path, options) => session.authorized(path, options)).list().then(out => { if (alive && session.snapshot().generation === gen) {
            setItems(out.items);
            setNext(out.next);
        } }).catch(e => { if (alive && session.snapshot().generation === gen)
            setError(apiMessage(e)); }).finally(() => { if (alive && session.snapshot().generation === gen)
            setBusy(false); });
        return () => { alive = false; };
    }, [auth.session, auth.generation, auth.phase]);
    async function submit() { if (busy)
        return; setBusy(true); setError(''); try {
        const out = await new ReportsAPI((path, options) => auth.session.authorized(path, options)).submit(work, version, reason);
        if (current()) {
            setSelected(out);
            setItems(old => [out, ...old.filter(x => x.id !== out.id)]);
            setSent(true);
            setReason('');
        }
    }
    catch (e) {
        if (current())
            setError(apiMessage(e) + ' 若结果未确认，可刷新我的举报核对原记录。');
    }
    finally {
        if (current())
            setBusy(false);
    } }
    return <SafeAreaView style={s.root}><View style={s.header}><Pressable onPress={() => router.back()} accessibilityLabel="返回"><Text>返回</Text></Pressable><Text style={s.title}>我的举报</Text></View><ScrollView contentContainerStyle={s.body} keyboardShouldPersistTaps="handled">
 {auth.phase !== 'ready' ? <><Text>登录后可以提交和查看本人举报。</Text><Pressable onPress={() => router.push('/account')}><Text style={s.link}>前往登录</Text></Pressable></> : <>
 {work && !sent ? <View style={s.group}><Text style={s.title}>举报这篇内容</Text><Text style={s.muted}>请说明具体问题；同一账号对同一版本只保留一条举报。</Text><TextInput accessibilityLabel="举报说明" value={reason} onChangeText={setReason} editable={!busy} multiline maxLength={2000} style={s.input} placeholder="具体哪里存在问题"/><Pressable disabled={busy || !reason.trim()} onPress={() => void submit()} style={s.button}><Text style={s.link}>{busy ? '正在提交…' : '提交举报'}</Text></Pressable></View> : null}
 {error ? <Text accessibilityRole="alert" style={s.error}>{error}</Text> : null}
 {selected ? <View style={s.group}><Text style={s.title}>举报 #{selected.id} · {selected.state === 'pending' ? '核查中' : selected.outcome === 'handled' ? '已处置' : '已核查，无需处置'}</Text><Text>{selected.reason}</Text>{selected.response ? <><Text style={s.muted}>处理回执</Text><Text>{selected.response}</Text></> : null}<Pressable onPress={() => router.push({ pathname: '/works/[id]', params: { id: selected.work_id } })}><Text style={s.link}>查看当前公开内容</Text></Pressable><Text style={s.muted}>处理回执不保证内容此刻仍可公开访问。</Text></View> : null}
 <View style={s.header}><Text style={s.title}>举报记录</Text><Pressable disabled={busy} onPress={() => void load()}><Text style={s.link}>刷新</Text></Pressable></View>
 {!items.length ? <Text style={s.muted}>{busy ? '正在读取…' : '尚无举报记录。'}</Text> : items.map(item => <Pressable key={item.id} disabled={busy} onPress={() => setSelected(item)} style={s.row}><Text>#{item.id} · {item.state === 'pending' ? '核查中' : '已结案'}</Text><Text numberOfLines={2} style={s.muted}>{item.reason}</Text></Pressable>)}
 {next > 0 ? <Pressable disabled={busy} onPress={() => void load(true)}><Text style={s.link}>加载更多</Text></Pressable> : null}</>}
 </ScrollView></SafeAreaView>;
}
const s = StyleSheet.create({ root: { flex: 1, backgroundColor: 'white' }, header: { padding: 16, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 16 }, title: { fontSize: 16, fontWeight: '600', color: t.ink }, body: { padding: 16, gap: 24 }, group: { gap: 16 }, input: { borderWidth: 1, borderColor: '#ddd', borderRadius: 4, minHeight: 128, padding: 16, textAlignVertical: 'top', color: t.ink }, button: { paddingVertical: 12, alignItems: 'center' }, link: { color: t.brand }, muted: { color: '#666', lineHeight: 22 }, error: { color: '#a32626' }, row: { paddingVertical: 16, gap: 8, borderBottomWidth: 1, borderBottomColor: '#eee' } });
