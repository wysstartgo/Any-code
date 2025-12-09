import React from "react";
import { ClaudeIcon } from "@/components/icons/ClaudeIcon";
import { CodexIcon } from "@/components/icons/CodexIcon";
import { GeminiIcon } from "@/components/icons/GeminiIcon";
import { MessageBubble } from "./MessageBubble";
import { MessageContent } from "./MessageContent";
import { ToolCallsGroup } from "./ToolCallsGroup";
import { ThinkingBlock } from "./ThinkingBlock";
import { MessageActions } from "./MessageActions";
import { cn } from "@/lib/utils";
import { tokenExtractor } from "@/lib/tokenExtractor";
import { formatTimestamp } from "@/lib/messageUtils";
import type { ClaudeStreamMessage } from '@/types/claude';

interface AIMessageProps {
  /** 消息数据 */
  message: ClaudeStreamMessage;
  /** 是否正在流式输出 */
  isStreaming?: boolean;
  /** 自定义类名 */
  className?: string;
  /** 链接检测回调 */
  onLinkDetected?: (url: string) => void;
}

/**
 * 提取AI消息的文本内容
 */
const extractAIText = (message: ClaudeStreamMessage): string => {
  if (!message.message?.content) return '';
  
  const content = message.message.content;
  
  // 如果是字符串，直接返回
  if (typeof content === 'string') return content;
  
  // 如果是数组，提取所有text类型的内容
  if (Array.isArray(content)) {
    return content
      .filter((item: any) => item.type === 'text')
      .map((item: any) => item.text)
      .join('\n\n');
  }
  
  return '';
};

/**
 * 检测消息中是否有工具调用
 *
 * 注意：只检查 tool_use，不检查 tool_result
 * tool_result 是工具执行的结果，通常通过 ToolCallsGroup 根据 tool_use 匹配显示
 * Codex 的 function_call_output 事件会生成仅包含 tool_result 的消息，
 * 这些消息不应该触发工具卡片渲染（避免空白消息卡片）
 */
const hasToolCalls = (message: ClaudeStreamMessage): boolean => {
  if (!message.message?.content) return false;

  const content = message.message.content;
  if (!Array.isArray(content)) return false;

  return content.some((item: any) => item.type === 'tool_use');
};

/**
 * 检测消息中是否有思考块
 */
const hasThinkingBlock = (message: ClaudeStreamMessage): boolean => {
  if (!message.message?.content) return false;

  const content = message.message.content;
  if (!Array.isArray(content)) return false;

  return content.some((item: any) => item.type === 'thinking');
};

/**
 * 提取思考块内容
 * 
 * ✅ FIX: 使用特殊的分隔符连接多个思考块，以便 ThinkingBlock 组件能够识别并渲染分割线
 */
const extractThinkingContent = (message: ClaudeStreamMessage): string => {
  if (!message.message?.content) return '';

  const content = message.message.content;
  if (!Array.isArray(content)) return '';

  const thinkingBlocks = content.filter((item: any) => item.type === 'thinking');
  // 使用特殊的不可见分隔符+换行符，以便 ThinkingBlock 可以识别分割点
  // 使用 ---divider--- 作为明确的分割标记
  return thinkingBlocks.map((item: any) => item.thinking || '').join('\n\n---divider---\n\n');
};

/**
 * AI消息组件（重构版）
 * 左对齐卡片样式，支持工具调用展示和思考块
 *
 * 打字机效果逻辑：
 * - 统一依赖 isStreaming prop（只有在流式输出时才启用）
 * - isStreaming 由 SessionMessages 组件传入，表示当前是最后一条消息且会话正在进行
 * - 历史消息加载时 isStreaming=false，不会触发打字机效果
 */
export const AIMessage: React.FC<AIMessageProps> = ({
  message,
  isStreaming = false,
  className,
  onLinkDetected
}) => {
  const text = extractAIText(message);
  const hasTools = hasToolCalls(message);
  const hasThinking = hasThinkingBlock(message);
  const thinkingContent = hasThinking ? extractThinkingContent(message) : '';

  // Detect engine type for avatar styling
  const isCodexMessage = (message as any).engine === 'codex';
  const isGeminiMessage = (message as any).geminiMetadata?.provider === 'gemini' || (message as any).engine === 'gemini';

  // 🐛 DEBUG: Log when rendering Gemini message with tools
  if (isGeminiMessage && process.env.NODE_ENV === 'development') {
    const content = message.message?.content;
    const toolUseItems = Array.isArray(content) ? content.filter((c: any) => c.type === 'tool_use') : [];
    if (toolUseItems.length > 0) {
      console.log('[AIMessage] Rendering Gemini message:', {
        hasTools,
        toolCount: toolUseItems.length,
        tools: toolUseItems.map((t: any) => ({ name: t.name, id: t.id })),
        hasText: !!text
      });
    }
  }

  // 打字机效果只在流式输出时启用
  // isStreaming=true 表示：当前是最后一条消息 && 会话正在进行中
  const enableTypewriter = isStreaming;

  // 如果既没有文本又没有工具调用又没有思考块，不渲染
  if (!text && !hasTools && !hasThinking) return null;

  // 提取 tokens 统计
  const tokenStats = message.message?.usage ? (() => {
    const extractedTokens = tokenExtractor.extract({
      type: 'assistant',
      message: { usage: message.message.usage }
    });
    const parts = [`${extractedTokens.input_tokens}/${extractedTokens.output_tokens}`];
    if (extractedTokens.cache_creation_tokens > 0) {
      parts.push(`创建${extractedTokens.cache_creation_tokens}`);
    }
    if (extractedTokens.cache_read_tokens > 0) {
      parts.push(`缓存${extractedTokens.cache_read_tokens}`);
    }
    return parts.join(' | ');
  })() : null;

  const assistantName = isGeminiMessage ? 'Gemini' : isCodexMessage ? 'Codex' : 'Claude';
  
  // Select icon based on engine
  const Icon = isGeminiMessage ? GeminiIcon : isCodexMessage ? CodexIcon : ClaudeIcon;

  return (
    <div className={cn("relative group", className)}>
      <MessageBubble variant="assistant">
        <div className="flex gap-4 items-start">
          {/* Left Column: Avatar */}
          <div className="flex-shrink-0 mt-0.5 select-none">
            <div className="flex items-center justify-center w-7 h-7">
              <Icon className={cn(isGeminiMessage || isCodexMessage ? "w-4 h-4" : "w-5 h-5")} />
            </div>
          </div>

          {/* Right Column: Content */}
          <div className="flex-1 min-w-0 space-y-1 relative">
            {/* Actions Toolbar - Visible on Hover */}
            <div className="absolute -top-2 right-0 opacity-0 group-hover:opacity-100 transition-opacity duration-200 z-10">
              <MessageActions content={text || thinkingContent} />
            </div>
            
            {/* Main Content */}
            <div className="space-y-3">
              {text && (
                <div className="prose prose-neutral dark:prose-invert max-w-none leading-relaxed text-[15px]">
                  <MessageContent
                    content={text}
                    isStreaming={enableTypewriter && !hasTools && !hasThinking}
                    enableTypewriter={enableTypewriter && !hasTools && !hasThinking}
                  />
                </div>
              )}

              {/* Thinking Block */}
              {hasThinking && thinkingContent && (
                <ThinkingBlock
                  content={thinkingContent}
                  isStreaming={enableTypewriter}
                  autoCollapseDelay={2500}
                />
              )}

              {/* Tool Calls */}
              {hasTools && (
                <div className="mt-2">
                  <ToolCallsGroup
                    message={message}
                    onLinkDetected={onLinkDetected}
                  />
                </div>
              )}
            </div>

            {/* Footer: Meta Info (Hover Only) */}
            <div className="flex items-center justify-end gap-2 pt-1 text-[10px] text-muted-foreground/40 opacity-0 group-hover:opacity-100 transition-opacity duration-200 select-none">
              <span className="font-medium">{assistantName}</span>
              {formatTimestamp((message as any).receivedAt ?? (message as any).timestamp) && (
                <>
                  <span>•</span>
                  <span>
                    {formatTimestamp((message as any).receivedAt ?? (message as any).timestamp)}
                  </span>
                </>
              )}
              {tokenStats && (
                <>
                  <span>•</span>
                  <span className="font-mono opacity-80">
                    {tokenStats}
                  </span>
                </>
              )}
            </div>
          </div>
        </div>
      </MessageBubble>
    </div>
  );
};
