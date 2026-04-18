// ==UserScript==
// @name         腾讯元宝
// @namespace    http://tampermonkey.net/
// @version      1.0
// @description  获取jsonl数据执行任务
// @author       You
// @match        https://yuanbao.tencent.com/*
// @grant        none
// ==/UserScript==

/**
 * 自动执行和提交脚本
 * 功能：每隔3秒获取网页元素并自动操作
 */
(function () {
    'use strict';

    // 存储已处理的call_id，避免重复处理
    const processedCallIds = [];
    const jsonlErr = `jsonl格式不对,需要遵循以下格式并且call_id增加:
{"type": "function_call_start", "name": "function_name", "call_id": 1}
{"type": "description", "text": "Short 1 line of what this function does"}
{"type": "parameter", "key": "parameter_1", "value": "value_1"}
{"type": "parameter", "key": "parameter_2", "value": "value_2"}
{"type": "function_call_end", "call_id": 1}
`;
    let lastText = '';

    // 查找并插入文本到输入框
    function findAndInsertText(text) {
        text = `<function_result>${text}</function_result>`;
        const textareas = document.querySelectorAll('.chat-input-editor');

        if (textareas.length === 0) {
            console.log('未找到textarea元素');
            return false;
        }
        console.log('textareas.length', textareas.length);

        for (let i = 0; i < textareas.length; i++) {
            const textarea = textareas[i];
            console.log('尝试插入到textarea:', i);

            try {
                textarea.focus();
                document.execCommand('insertText', false, text);
                console.log('通过execCommand插入成功');
                //
                setTimeout(() => {
                    const sendBtn = document.getElementById('yuanbao-send-btn');
                    if (sendBtn) {
                        sendBtn.click();
                        console.log('已点击发送按钮');
                    } else {
                        console.log('没找到按钮，用方案2');
                    }
                }, 3000);





                return true;

            } catch (error) {
                console.log(`插入textarea[${i}]时出错:`, error);
            }
        }

        console.log('所有尝试失败');
        return false;
    }

    // 解析jsonl到rpc
    function convertJSONLtoJSONRPC(jsonlData) {
        const lines = jsonlData;
        let result = {
            jsonrpc: "2.0",
            id: null,
            method: "",
            params: {
                name: "",
                arguments: {},
            },
        };

        let currentCallId = null;
        let functionName = "";
        let description = "";

        for (const line of lines) {
            try {
                const obj = line;

                switch (obj.type) {
                    case "function_call_start":
                        currentCallId = obj.call_id;
                        functionName = obj.name;
                        result.id = currentCallId;
                        result.method = "tools/call";
                        result.params.name = functionName;
                        break;

                    case "description":
                        description = obj.text;
                        // 可以将描述作为元数据添加到params中
                        if (!result.params.arguments) {
                            result.params.arguments = {};
                        }
                        result.params.arguments._description = description;
                        break;

                    case "parameter":
                        if (!result.params.arguments) {
                            result.params.arguments = {};
                        }
                        result.params.arguments[obj.key] = obj.value;
                        break;

                    case "function_call_end":
                        // 验证call_id是否匹配
                        if (currentCallId !== obj.call_id) {
                            console.warn(
                                `警告: 函数调用结束的ID不匹配: ${currentCallId} !== ${obj.call_id}`
                            );
                        }
                        break;

                    default:
                        console.warn(`未知的事件类型: ${obj.type}`);
                }
            } catch (error) {
                console.log(`解析JSONL行失败: ${line}`, error);
            }
        }

        return result;
    }

    // 执行请求
    async function callMCPWithJSONRPC(exampleJSONL, callback) {
        const serverUrl = "http://localhost:3006/mcp";
        const jsonRpcRequest = convertJSONLtoJSONRPC(exampleJSONL);
        console.log('jsonRpcRequest', jsonRpcRequest);
        // 检查重复 call_id
        if (jsonRpcRequest.id && processedCallIds.includes(jsonRpcRequest.id)) {
            console.log(`已处理过call_id: ${jsonRpcRequest.id}，跳过`);
            return null;
        }

        console.log("发送JSON-RPC请求:\n", JSON.stringify(jsonRpcRequest, null, 2));

        try {
            const response = await fetch(serverUrl, {
                method: "POST",
                headers: {
                    "Content-Type": "application/json",
                    Accept: "application/json, text/event-stream",
                },
                body: JSON.stringify(jsonRpcRequest),
            });

            console.log("\n响应状态:", response.status);
            const contentType = response.headers.get("content-type") || "";
            console.log("内容类型:", contentType);

            let resultText = "";

            if (contentType.includes("text/event-stream")) {
                // ========== 修复：SSE 流式解析（支持跨 chunk 拼接）==========
                const reader = response.body.getReader();
                const decoder = new TextDecoder();
                let buffer = ""; // 【关键】缓存不完整行

                while (true) {
                    const { done, value } = await reader.read();
                    if (done) break;

                    // 拼接 chunk 到缓冲区
                    buffer += decoder.decode(value, { stream: true });

                    // 按行分割（只处理完整行）
                    const lines = buffer.split("\n");
                    // 最后一行可能不完整，放回缓冲区
                    buffer = lines.pop();

                    // 逐行解析
                    for (const line of lines) {
                        const trimmedLine = line.trim();
                        if (!trimmedLine.startsWith("data: ")) continue;

                        const dataStr = trimmedLine.slice(6).trim();
                        if (!dataStr || dataStr === "[DONE]") continue;

                        try {
                            const data = JSON.parse(dataStr);
                            console.log("解析 SSE 数据:", data);

                            // 拼接所有文本（修复：不再丢失）
                            if (data.error?.message) { // 错误
                                resultText = data.error?.message
                            }
                            if (data.result?.content) {
                                for (const content of data.result.content) {
                                    if (content.text) resultText += content.text;
                                }
                            }
                        } catch (e) {
                            // 修复：打印真实错误，方便排查
                            console.error("SSE 数据解析失败:", e, "\n原始数据:", dataStr);
                        }
                    }
                }

                // 处理缓冲区剩余的最后一行
                if (buffer.trim().startsWith("data: ")) {
                    const dataStr = buffer.trim().slice(6).trim();
                    if (dataStr && dataStr !== "[DONE]") {
                        try {
                            const data = JSON.parse(dataStr);
                            if (data.result?.content) {
                                for (const content of data.result.content) {
                                    if (content.text) resultText += content.text;
                                }
                            }
                        } catch (e) {
                            console.error("最后一行解析失败:", e, buffer);
                        }
                    }
                }
            } else {
                // ========== 修复：普通 JSON 响应（不再 break）==========
                const result = await response.json();
                console.log("\n普通响应结果:\n", JSON.stringify(result, null, 2));

                if (result.result?.content) {
                    for (const content of result.result.content) {
                        if (content.text) resultText += content.text; // 修复：拼接，不 break
                    }
                }
            }

            // 回调
            if (callback && typeof callback === "function" && resultText) {
                callback(resultText);
            }

            // 标记已处理
            if (jsonRpcRequest.id) {
                processedCallIds.push(jsonRpcRequest.id);
            }

            console.log("最终完整结果:\n", resultText);
            return resultText;
        } catch (error) {
            console.error("调用失败:", error);
            return null;
        }
    }
    /**
     * 将函数调用数据组装为 MCP With JSON-RPC 的 body 参数
     * @param {Array} functionCallData - 函数调用数据数组
     * @returns {Object} MCP JSON-RPC 请求对象
     */
    function assembleMCPJSONRPCBody(functionCallData) {
        // 提取函数调用信息
        let functionStart = null;
        let parameters = {};
        let description = null;

        for (const item of functionCallData) {
            switch (item.type) {
                case 'function_call_start':
                    functionStart = item;
                    break;
                case 'description':
                    description = item.text;
                    break;
                case 'parameter':
                    if (item.key && item.value !== undefined) {
                        parameters[item.key] = item.value;
                    }
                    break;
                case 'function_call_end':
                    // 不需要额外处理，只是标记结束
                    break;
            }
        }

        // 验证必需字段
        if (!functionStart) {
            throw new Error('Missing function_call_start in the data');
        }

        if (!functionStart.name) {
            throw new Error('Missing function name in function_call_start');
        }

        // 构建 JSON-RPC 请求对象
        const jsonRPCBody = {
            jsonrpc: '2.0',
            id: functionStart.call_id || Date.now(), // 使用 call_id 或生成唯一 ID
            method: 'tools/call',
            params: {
                name: functionStart.name,
                arguments: parameters
            }
        };

        // 如果有描述信息，可以添加到 params 中（可选）
        if (description) {
            jsonRPCBody.params._description = description;
        }

        return jsonRPCBody;
    }
    /**
     * 从 JSON 格式的函数调用内容中提取参数
     * @param {string} content - 包含 JSON 函数调用的文本内容
     * @returns {Object} 参数名到参数值的映射对象
     */
    function extractJSONParameters(content) {
        const parameters = [];

        // 验证输入
        if (!content || typeof content !== 'string') {
            console.debug('[JSON Parser] extractJSONParameters: Invalid content');
            return parameters;
        }

        // 解析单行 JSON 对象
        function parseJSONLine(line) {
            try {
                const trimmed = line.trim();
                // console.log('trimmed', trimmed);

                if (!trimmed) return null;

                // 清理语言标签（如 "jsonCopy code"）
                let cleaned = trimmed;
                // 移除常见的语言标签前缀
                cleaned = cleaned.replace(/^(jsonl?|javascript|typescript|python|bash|shell)(\s*copy(\s*code)?)?\s*/i, '');
                // 移除 "Copy code" 等按钮文本
                cleaned = cleaned.replace(/^[cC]opy(\s+code)?\s*/i, '');

                if (!cleaned || (!cleaned.startsWith('{') && !cleaned.startsWith('['))) {
                    return null;
                }

                const parsed = JSON.parse(cleaned);

                // 验证是否为有效的函数调用行
                if (!parsed.type || typeof parsed.type !== 'string') {
                    return null;
                }

                return parsed;
            } catch (e) {
                return null;
            }
        }

        // 分割成行（支持 Unicode 换行符）
        const lines = content.split(/\r?\n|\u2028|\u2029/);

        // 第一遍：从完整的、可解析的 JSON 行中提取参数
        for (const line of lines) {
            const parsed = parseJSONLine(line);
            // console.log('parsed', parsed);
            if (!parsed) continue;
            parameters.push(parsed)
        }

        return parameters;
    }
    /**
     * 获取指定元素的内容，等待内容稳定后返回
     * @param {HTMLElement} element - 目标DOM元素
     * @param {number} stabilityTimeoutMs - 稳定性检测超时时间（毫秒），默认5000ms
     * @param {number} checkIntervalMs - 检查间隔（毫秒），默认100ms
     * @returns {Promise<string>} 稳定的文本内容
     */
    async function getStableTextContent(element, stabilityTimeoutMs = 5000, checkIntervalMs = 100) {
        if (!element) {
            throw new Error('Element is null or undefined');
        }

        let lastContent = element.textContent || '';
        let lastChangeTime = Date.now();
        let hasChange = false;

        return new Promise((resolve, reject) => {
            const startTime = Date.now();
            let checkInterval = null;
            let timeoutId = null;

            // 清理函数
            const cleanup = () => {
                if (checkInterval) clearInterval(checkInterval);
                if (timeoutId) clearTimeout(timeoutId);
            };

            // 检查内容是否稳定
            const checkStability = () => {
                const currentContent = element.textContent || '';
                const now = Date.now();

                // 检查内容是否有变化
                if (currentContent !== lastContent) {
                    // 内容发生变化，更新时间戳和内容
                    lastContent = currentContent;
                    lastChangeTime = now;
                    hasChange = true;

                    if (window.debugMode) {
                        console.log(`[getStableTextContent] Content changed at ${new Date(now).toISOString()}`);
                    }
                }

                // 检查是否稳定（距离上次变化超过稳定时间）
                const timeSinceLastChange = now - lastChangeTime;
                const isStable = timeSinceLastChange >= stabilityTimeoutMs;

                // 检查是否超时（从开始到现在超过最大等待时间）
                const totalElapsed = now - startTime;
                const maxWaitTime = stabilityTimeoutMs * 2; // 最大等待时间为稳定时间的2倍
                const isTimeout = totalElapsed >= maxWaitTime;

                if (isStable || isTimeout) {
                    if (isTimeout && hasChange) {
                        console.warn(`[getStableTextContent] Timeout waiting for content to stabilize after ${totalElapsed}ms, returning last content`);
                    } else if (isTimeout && !hasChange) {
                        console.log(`[getStableTextContent] No changes detected within ${totalElapsed}ms`);
                    } else {
                        console.log(`[getStableTextContent] Content stabilized after ${timeSinceLastChange}ms without changes`);
                    }

                    cleanup();
                    resolve(lastContent);
                }
            };

            // 启动定时检查
            checkInterval = setInterval(checkStability, checkIntervalMs);

            // 设置总超时保护
            timeoutId = setTimeout(() => {
                cleanup();
                const finalContent = element.textContent || '';
                console.warn(`[getStableTextContent] Total timeout reached after ${stabilityTimeoutMs * 2}ms, returning current content`);
                resolve(finalContent);
            }, stabilityTimeoutMs * 2);
        });
    }
    /**
 * 原始方法的改进版本（使用async/await）
 * @param {HTMLElement} lastResponseMessage - 包含响应消息的DOM元素
 * @returns {Promise<string>} 稳定的文本内容
 */
    async function getStablePreElementText(lastResponseMessage) {
        // 获取目标元素
        const targetElement = lastResponseMessage?.querySelectorAll('.language-jsonl')[0];

        if (!targetElement) {
            console.warn('No element with class .language-jsonl found');
            return '';
        }

        // 等待内容稳定后获取
        const stableContent = await getStableTextContent(targetElement, 5000, 100);

        return stableContent;
    }
    function isValidSequence(arr) {
        if (!Array.isArray(arr) || arr.length === 0) return false;

        const firstType = arr[0]?.type;
        const lastType = arr[arr.length - 1]?.type;

        return firstType === 'function_call_start' && lastType === 'function_call_end';
    }

    /**
     * 主循环函数
     */
    async function mainLoop() {
        try {
            // 查找最后一个具有agent-chat__speech-text--box-left类的元素
            const responseMessages = document.querySelectorAll('.agent-chat__speech-text--box-left');
            const lastResponseMessage = responseMessages[responseMessages.length - 1];
            // 获取所有pre标签
            // var preElementsText = lastResponseMessage.querySelectorAll('.language-jsonl')[0].textContent;
            const preElementsText = await getStablePreElementText(lastResponseMessage);
            console.log('preElementsText', preElementsText);

            // DEBUG:
            // preElementsText = `{"type": "function_call_start", "name": "mcphub.desktop-commander-start_process", "call_id": 3}
            // {"type": "description", "text": "运行pwd命令获取当前工作目录"}
            // {"type": "parameter", "key": "command", "value": "pwd"}
            // {"type": "parameter", "key": "timeout_ms", "value": 5000}
            // {"type": "function_call_end", "call_id": 3}`;
            // [
            //     {
            //         "type": "function_call_start",
            //         "name": "mcphub.desktop-commander-get_file_info",
            //         "call_id": 6
            //     },
            //     {
            //         "type": "description",
            //         "text": "检查yuanbao.js文件是否存在并获取文件信息"
            //     },
            //     {
            //         "type": "parameter",
            //         "key": "path",
            //         "value": "/home/jcleng/work/mywork/MCP-SuperAssistant-fix-autosubmit/yuanbao.js"
            //     },
            //     {
            //         "type": "function_call_end",
            //         "call_id": 6
            //     }
            // ];
            // 将所有pre标签的内容拼接起来
            const jsonlDataArr = extractJSONParameters(preElementsText);
            console.log('jsonlDataArr', jsonlDataArr, JSON.stringify(jsonlDataArr));
            // return;





            // console.log('找到JSONL数据:', jsonlDataArr);

            // 从JSONL中提取call_id
            try {
                const lines = jsonlDataArr
                console.log('lines', lines);

                let callId = null;


                for (const _key in lines) {
                    const line = lines[_key];
                    console.log('⭕', line);
                    const obj = line;
                    // console.log('找到obj数据:', obj);
                    if (obj.type === "function_call_start") {
                        callId = obj.call_id;
                        break;
                    }
                }

                if (callId) {
                    // 检查是否已处理过
                    // if (processedCallIds.includes(callId)) {
                    //     console.log(`call_id ${callId} 已处理过，跳过`);
                    //     return;
                    // }
                    if (lastText == preElementsText) {
                        return;
                    }
                    if (!isValidSequence(jsonlDataArr)) {
                        findAndInsertText(jsonlErr);
                        return;
                    }

                    // 调用MCP服务
                    callMCPWithJSONRPC(jsonlDataArr, (resultText) => {
                        console.log('MCP调用完成，调用回调函数', resultText);
                        findAndInsertText(resultText);
                        lastText = preElementsText;
                    });
                } else {
                    if (jsonlDataArr?.length > 0) {
                        findAndInsertText(jsonlErr);
                        return;
                    }
                    console.log('未找到call_id，跳过');
                }
            } catch (parseError) {
                console.log('解析JSONL数据失败:', parseError);
            }

        } catch (error) {
            console.error('主循环执行出错:', error);
        }
    }

    // 启动定时器，每3秒执行一次
    console.log('[AutoScript] 脚本已启动，每3秒执行一次');
    setInterval(mainLoop, 3000);

    // 立即执行一次
    mainLoop();
})();
