import { useCallback, useEffect, useRef, useState } from 'react';
import axios from 'axios';
import { useAuth } from '../auth/AuthContext';
import { fetchConversation, fetchHistory, sendMessageStream } from '../api/chat';
import type { ConversationDetail, HistoryListData, SendChatRequest, StreamingExchange } from '../types/api';
import { sendIssue, validateMessage } from './errors';
import type { SendIssue } from './errors';

const NEW_CHAT = 'new';
const emptyHistory: HistoryListData = { conversations: [], pagination: { page: 1, limit: 5, total: 0, hasMore: false } };

export function useChat() {
  const { generation } = useAuth();
  const [history, setHistory] = useState(emptyHistory);
  const [historyLoading, setHistoryLoading] = useState(true);
  const [historyError, setHistoryError] = useState('');
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [conversation, setConversation] = useState<ConversationDetail | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);
  const [detailError, setDetailError] = useState('');
  const [drafts, setDrafts] = useState<Record<string, string>>({});
  const [issues, setIssues] = useState<Record<string, SendIssue | undefined>>({});
  const [sending, setSending] = useState(false);
  const [streaming, setStreaming] = useState<StreamingExchange | null>(null);
  const [recovering, setRecovering] = useState(false);
  const [announcement, setAnnouncement] = useState('');
  const alive = useRef(false);
  const selected = useRef<string | null>(null);
  const sendingLock = useRef(false);
  const recoveryLock = useRef(false);
  const detailPending = useRef(false);
  const requests = useRef({ list: null as AbortController | null, detail: null as AbortController | null, send: null as AbortController | null });
  const listSequence = useRef(0);
  const detailSequence = useRef(0);

  const loadHistory = useCallback(async (page: number): Promise<boolean> => {
    requests.current.list?.abort();
    const controller = new AbortController();
    requests.current.list = controller;
    const sequence = ++listSequence.current;
    setHistoryLoading(true);
    setHistoryError('');
    try {
      const result = await fetchHistory(page, { signal: controller.signal, sessionGeneration: generation });
      if (!alive.current || controller.signal.aborted || sequence !== listSequence.current) return false;
      setHistory(result);
      return true;
    } catch (error: unknown) {
      if (alive.current && !controller.signal.aborted && sequence === listSequence.current && !axios.isCancel(error)) {
        setHistoryError('Saved conversations could not be loaded. You can refresh the list without sending a message again.');
      }
      return false;
    } finally {
      if (alive.current && !controller.signal.aborted && sequence === listSequence.current) setHistoryLoading(false);
    }
  }, [generation]);

  const loadDetail = useCallback(async (id: string): Promise<boolean> => {
    requests.current.detail?.abort();
    const controller = new AbortController();
    requests.current.detail = controller;
    const sequence = ++detailSequence.current;
    detailPending.current = true;
    setDetailLoading(true);
    setDetailError('');
    try {
      const result = await fetchConversation(id, { signal: controller.signal, sessionGeneration: generation });
      if (!alive.current || controller.signal.aborted || sequence !== detailSequence.current || selected.current !== id) return false;
      setConversation(result);
      return true;
    } catch (error: unknown) {
      if (alive.current && !controller.signal.aborted && sequence === detailSequence.current && !axios.isCancel(error)) {
        setDetailError('This conversation could not be loaded. Try reloading it or choose another conversation.');
      }
      return false;
    } finally {
      if (alive.current && !controller.signal.aborted && sequence === detailSequence.current) {
        detailPending.current = false;
        setDetailLoading(false);
      }
    }
  }, [generation]);

  useEffect(() => {
    alive.current = true;
    const controllers = requests.current;
    let cancelled = false;
    // Let StrictMode's setup/cleanup settle before starting the initial HTTP read.
    // There is no shared cache that could outlive the authenticated subtree.
    queueMicrotask(() => { if (!cancelled) void loadHistory(1); });
    return () => {
      cancelled = true;
      alive.current = false;
      controllers.list?.abort(); controllers.detail?.abort(); controllers.send?.abort();
    };
  }, [loadHistory]);

  const selectConversation = (id: string) => {
    if (sendingLock.current || recoveryLock.current || (selected.current === id && !detailError)) return;
    selected.current = id;
    setSelectedId(id);
    setConversation(null);
    setAnnouncement('');
    void loadDetail(id);
  };
  const newChat = () => {
    if (sendingLock.current || recoveryLock.current) return;
    requests.current.detail?.abort();
    detailSequence.current++;
    detailPending.current = false;
    selected.current = null;
    setSelectedId(null); setConversation(null); setDetailLoading(false); setDetailError(''); setAnnouncement('');
  };
  const key = selectedId ?? NEW_CHAT;
  const draft = drafts[key] ?? '';
  const issue = issues[key];
  const full = (conversation?.messages.length ?? 0) >= 200 || issue?.recovery === 'new';
  const blocked = sending || recovering || detailLoading || Boolean(selectedId && !conversation) || full || issue?.recovery === 'reload';

  const updateDraft = (value: string) => {
    if (sendingLock.current) return;
    setDrafts((previous) => ({ ...previous, [key]: value }));
  };
  const submit = async () => {
    if (sendingLock.current || recoveryLock.current || detailPending.current || blocked) return;
    const selection = selected.current;
    const draftKey = selection ?? NEW_CHAT;
    const input: SendChatRequest = { message: draft.trim(), ...(selection ? { conversationId: selection } : {}) };
    const validation = validateMessage(input);
    if (validation) {
      setIssues((previous) => ({ ...previous, [draftKey]: { message: validation, recovery: 'retry' } }));
      return;
    }
    sendingLock.current = true;
    setSending(true); setAnnouncement('');
    setStreaming({ userContent: input.message, assistantContent: '', startedAt: new Date().toISOString() });
    setIssues((previous) => ({ ...previous, [draftKey]: undefined }));
    const controller = new AbortController();
    requests.current.send = controller;
    try {
      const result = await sendMessageStream(input, { signal: controller.signal, sessionGeneration: generation }, (text) => {
        if (!alive.current || controller.signal.aborted) return;
        setStreaming((previous) => previous ? { ...previous, assistantContent: previous.assistantContent + text } : null);
      });
      if (!alive.current || controller.signal.aborted) return;
      selected.current = result.conversationId;
      setSelectedId(result.conversationId);
      setConversation((previous) => ({
        id: result.conversationId, title: result.title,
        createdAt: previous?.createdAt ?? result.userMessage.createdAt, updatedAt: result.updatedAt,
        messages: [...(previous?.messages ?? []), result.userMessage, result.assistantMessage],
      }));
      setDrafts((previous) => ({ ...previous, [draftKey]: '', [result.conversationId]: '' }));
      setStreaming(null);
      setAnnouncement('Reply saved.');
      // A list-read failure must not undo the acknowledged pair or reissue the POST.
      void loadHistory(1);
    } catch (error: unknown) {
      if (alive.current && !controller.signal.aborted && !axios.isCancel(error)) {
        setStreaming(null);
        setIssues((previous) => ({ ...previous, [draftKey]: sendIssue(error) }));
      }
    } finally {
      sendingLock.current = false;
      if (alive.current) setSending(false);
    }
  };
  const reloadSaved = async () => {
    if (sendingLock.current || recoveryLock.current) return;
    recoveryLock.current = true; setRecovering(true);
    const id = selected.current;
    const draftKey = id ?? NEW_CHAT;
    try {
      const results = await Promise.all([loadHistory(1), ...(id ? [loadDetail(id)] : [])]);
      if (alive.current && results.every(Boolean)) {
        setIssues((previous) => ({
          ...previous,
          [draftKey]: previous[draftKey] ? {
            message: 'Saved history reloaded. Compare it with your draft before sending again; a delayed request may still finish.',
            recovery: 'reviewed',
          } : undefined,
        }));
      }
    } finally {
      recoveryLock.current = false;
      if (alive.current) setRecovering(false);
    }
  };
  const changePage = (page: number) => {
    if (!sendingLock.current && !recoveryLock.current && !historyLoading) void loadHistory(page);
  };
  const refreshHistory = () => {
    if (!sendingLock.current && !recoveryLock.current && !historyLoading) void loadHistory(history.pagination.page);
  };
  const retryDetail = () => {
    if (selected.current && !sendingLock.current && !recoveryLock.current) void loadDetail(selected.current);
  };
  return { history, historyLoading, historyError, selectedId, conversation, detailLoading, detailError,
    draft, issue, sending, streaming, recovering, announcement, blocked, full, updateDraft, submit, selectConversation,
    newChat, reloadSaved, changePage, refreshHistory, retryDetail };
}
