import React, { useImperativeHandle, forwardRef, useEffect, useRef } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { useVirtualizer } from "@tanstack/react-virtual";
import { StreamMessageV2 } from "@/components/message";
import type { MessageGroup } from "@/lib/subagentGrouping";
import { useSession } from "@/contexts/SessionContext";
import { CliProcessingIndicator } from "./CliProcessingIndicator";

/**
 * ✅ MeasurableItem: 自动监听高度变化的虚拟列表项
 * 
 * 使用 ResizeObserver 并在内容变化时自动通知虚拟列表重新测量。
 * 仅对正在流式输出的消息进行防抖，历史消息立即更新以防止滚动抖动。
 */
const MeasurableItem = ({ virtualItem, measureElement, isStreaming, children, ...props }: any) => {
  const elRef = useRef<HTMLDivElement>(null);
  const measureRef = useRef(measureElement);
  
  // 保持 measureElement 引用最新
  useEffect(() => {
    measureRef.current = measureElement;
  }, [measureElement]);

  useEffect(() => {
    const el = elRef.current;
    if (!el) return;

    // 初始测量 - 立即执行确保占位准确
    measureRef.current(el);

    let frameId: number;

    // 创建观察者
    const observer = new ResizeObserver(() => {
      if (isStreaming) {
        // ✅ 流式消息：使用防抖，避免每帧重绘导致的性能问题
        cancelAnimationFrame(frameId);
        frameId = requestAnimationFrame(() => {
          if (elRef.current) {
            measureRef.current(elRef.current);
          }
        });
      } else {
        // ✅ 历史消息：立即响应（通过 rAF 避免 Loop 错误），确保向上滚动时高度修正及时，减少抖动
        requestAnimationFrame(() => {
          if (elRef.current) {
            measureRef.current(elRef.current);
          }
        });
      }
    });

    observer.observe(el);

    return () => {
      observer.disconnect();
      cancelAnimationFrame(frameId);
    };
  }, [isStreaming]); // 添加 isStreaming 依赖

  return (
    <motion.div
      {...props}
      ref={elRef}
      data-index={virtualItem.index}
    >
      {children}
    </motion.div>
  );
};

export interface SessionMessagesRef {
  scrollToPrompt: (promptIndex: number) => void;
}

/**
 * ✅ 架构优化: 简化 Props 接口，移除可从 SessionContext 获取的数据
 *
 * 优化前: 10+ 个 props，包含配置、回调和会话数据
 * 优化后: 只保留核心渲染相关的 props
 *
 * 从 SessionContext 获取:
 * - claudeSettings → settings
 * - effectiveSession → session, sessionId, projectId, projectPath
 * - handleLinkDetected → onLinkDetected
 * - handleRevert → onRevert
 * - getPromptIndexForMessage → getPromptIndexForMessage
 */
interface SessionMessagesProps {
  messageGroups: MessageGroup[];
  isLoading: boolean;
  error?: string | null;
  parentRef: React.RefObject<HTMLDivElement>;
  /** 取消执行回调 - 用于CLI风格处理指示器 */
  onCancel?: () => void;
}

export const SessionMessages = forwardRef<SessionMessagesRef, SessionMessagesProps>(({
  messageGroups,
  isLoading,
  error,
  parentRef,
  onCancel
}, ref) => {
  // ✅ 从 SessionContext 获取配置和回调，避免 Props Drilling
  const { settings, sessionId, projectId, projectPath, onLinkDetected, onRevert, getPromptIndexForMessage } = useSession();
  /**
   * ✅ OPTIMIZED: Virtual list configuration for improved performance
   */
  const rowVirtualizer = useVirtualizer({
    count: messageGroups.length,
    getScrollElement: () => parentRef.current,
    estimateSize: (index) => {
      // ✅ Dynamic height estimation based on message group type
      const messageGroup = messageGroups[index];
      if (!messageGroup) return 200;

      // For subagent groups, estimate larger height
      if (messageGroup.type === 'subagent') {
        return 400; // Subagent groups are typically larger
      }

      // For aggregated groups, estimate height based on content
      if (messageGroup.type === 'aggregated') {
        // Base height for bubble padding etc
        let height = 60;
        messageGroup.messages.forEach(msg => {
            // Add height for thinking blocks
            if (msg.type === 'thinking' || (msg.message?.content && Array.isArray(msg.message.content) && msg.message.content.some((c:any) => c.type === 'thinking'))) {
                height += 100;
            }
            // Add height for tool calls
            if (msg.message?.content && Array.isArray(msg.message.content)) {
                const toolCalls = msg.message.content.filter((c:any) => c.type === 'tool_use');
                height += toolCalls.length * 60;
                
                // Add height for tool results (if visible)
                const toolResults = msg.message.content.filter((c:any) => c.type === 'tool_result');
                height += toolResults.length * 40;
            }
        });
        return Math.max(height, 100);
      }

      // For normal messages, estimate based on message type
      const message = messageGroup.message;
      if (!message) return 200;

      // Estimate different heights for different message types
      if (message.type === 'system') return 80;  // System messages are smaller
      if (message.type === 'user') return 150;   // User prompts are medium
      if (message.type === 'assistant') {
        // Assistant messages with code blocks are larger
        const hasCodeBlock = message.content && typeof message.content === 'string' &&
                            message.content.includes('```');
        return hasCodeBlock ? 300 : 200;
      }
      return 200; // Default fallback
    },
    overscan: 12, // ✅ OPTIMIZED: Increased to 12 to prevent blank areas during fast scrolling
    measureElement: (element) => {
      // Ensure element is fully rendered before measurement
      return element?.getBoundingClientRect().height ?? 200;
    },
  });

  useImperativeHandle(ref, () => ({
    scrollToPrompt: (promptIndex: number) => {
      // 找到 promptIndex 对应的消息在 messageGroups 中的索引
      let currentPromptIndex = 0;
      let targetGroupIndex = -1;

      for (let i = 0; i < messageGroups.length; i++) {
        const group = messageGroups[i];

        // 检查普通消息
        if (group.type === 'normal') {
          const message = group.message;
          const messageType = (message as any).type || (message.message as any)?.role;

          if (messageType === 'user') {
            if (currentPromptIndex === promptIndex) {
              targetGroupIndex = i;
              break;
            }
            currentPromptIndex++;
          }
        }
        // 子代理组不包含 user 消息，跳过
      }

      if (targetGroupIndex === -1) {
        console.warn(`[Prompt Navigation] Prompt #${promptIndex} not found`);
        return;
      }

      console.log(`[Prompt Navigation] Navigating to prompt #${promptIndex}, group index: ${targetGroupIndex}`);

      // 先使用虚拟列表滚动到该索引（让元素渲染出来）
      rowVirtualizer.scrollToIndex(targetGroupIndex, {
        align: 'center',
        behavior: 'smooth',
      });

      // 等待虚拟列表渲染完成后，再进行精确定位
      setTimeout(() => {
        const element = document.getElementById(`prompt-${promptIndex}`);
        if (element) {
          element.scrollIntoView({ behavior: 'smooth', block: 'center' });
        }
      }, 300);
    }
  }));

  return (
    <div
      ref={parentRef}
      className="flex-1 overflow-y-auto relative"
      style={{
        paddingBottom: 'calc(240px + env(safe-area-inset-bottom))', // 增加底部空间，避免与动态高度的输入框重叠
        paddingTop: '20px',
      }}
    >
      <div
        className="relative w-full max-w-5xl lg:max-w-6xl xl:max-w-7xl 2xl:max-w-[85%] mx-auto px-4 pt-8 pb-4"
        style={{
          height: `${Math.max(rowVirtualizer.getTotalSize(), 100)}px`,
          minHeight: '100px',
        }}
      >
        <AnimatePresence>
          {rowVirtualizer.getVirtualItems().map((virtualItem) => {
            const messageGroup = messageGroups[virtualItem.index];

            // 防御性检查：确保 messageGroup 存在
            if (!messageGroup) {
              console.warn('[SessionMessages] messageGroup is undefined for index:', virtualItem.index);
              return null;
            }

            const message = messageGroup.type === 'normal' ? messageGroup.message : null;
            const originalIndex = messageGroup.type === 'normal' ? messageGroup.index : undefined;
            const promptIndex = message && message.type === 'user' && originalIndex !== undefined && getPromptIndexForMessage
              ? getPromptIndexForMessage(originalIndex)
              : undefined;

            const isStreaming = virtualItem.index === messageGroups.length - 1 && isLoading;

            return (
              <MeasurableItem
                key={virtualItem.key}
                virtualItem={virtualItem}
                measureElement={rowVirtualizer.measureElement}
                isStreaming={isStreaming}
                initial={{ opacity: 0, y: 20 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -20 }}
                transition={{ duration: 0.3 }}
                className="absolute inset-x-4"
                style={{
                  top: virtualItem.start,
                }}
              >
                {/* ✅ 架构优化: StreamMessageV2 现在从 SessionContext 获取数据 */}
                <StreamMessageV2
                  messageGroup={messageGroup}
                  onLinkDetected={onLinkDetected}
                  claudeSettings={settings}
                  isStreaming={isStreaming}
                  promptIndex={promptIndex}
                  sessionId={sessionId ?? undefined}
                  projectId={projectId ?? undefined}
                  projectPath={projectPath}
                  onRevert={onRevert}
                />
              </MeasurableItem>
            );
          })}
        </AnimatePresence>
      </div>

      {/* CLI风格的处理状态指示器 - 显示在消息列表底部 */}
      <CliProcessingIndicator
        isProcessing={isLoading && messageGroups.length > 0}
        onCancel={onCancel}
      />

      {/* Error indicator */}
      {error && (
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          className="rounded-lg border border-destructive/50 bg-destructive/10 p-4 text-sm text-destructive w-full max-w-5xl mx-auto"
          style={{ marginBottom: 'calc(80px + env(safe-area-inset-bottom))' }}
        >
          {error}
        </motion.div>
      )}
    </div>
  );
});

SessionMessages.displayName = "SessionMessages";