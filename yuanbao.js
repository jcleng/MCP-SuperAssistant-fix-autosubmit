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
    const processedCallIds = new Set();

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

        // 检查重复 call_id
        if (jsonRpcRequest.id && processedCallIds.has(jsonRpcRequest.id)) {
            // console.log(`已处理过call_id: ${jsonRpcRequest.id}，跳过`);
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
                processedCallIds.add(jsonRpcRequest.id);
            }

            console.log("最终完整结果:\n", resultText);
            return resultText;
        } catch (error) {
            console.error("调用失败:", error);
            return null;
        }
    }

    /**
     * 主循环函数
     */
    function mainLoop() {
        try {
            // 查找最后一个具有agent-chat__speech-text--box-left类的元素
            const responseMessages = document.querySelectorAll('.agent-chat__speech-text--box-left');

            if (responseMessages.length === 0) {
                console.log('未找到.agent-chat__speech-text--box-left元素');
                return;
            }

            const lastResponseMessage = responseMessages[responseMessages.length - 1];
            // 获取所有pre标签
            const preElementsText = lastResponseMessage.querySelectorAll('.language-jsonl')[0].textContent;


            // 将所有pre标签的内容拼接起来
            const jsonlDataArr = preElementsText
                // 1. 统一清洗所有特殊空白字符（先处理，避免分割异常）
                .replace(/\u3000|\u00A0/g, ' ')  // 全角空格、不间断空格 → 半角空格
                // 2. 按【真实换行】分割行（不使用任何中文分隔符，彻底避免冲突）
                .split(/\r?\n/)
                // 3. 过滤空行、纯空白行
                .filter(line => {
                    const trimLine = line.trim();
                    return trimLine !== '' && !/^\s*$/.test(trimLine);
                })
                // 4. 清洗字符 + 解析 JSON（更严谨的替换逻辑）
                .map(line => {
                    const cleanedLine = line
                        .replace(/[“”＂]/g, '"')       // 统一各类双引号为标准双引号
                        .replace(/，/g, ',')           // 全角逗号 → 半角逗号
                        .replace(/\s+/g, ' ');         // 多个空格合并为一个（可选，更干净）
                    try {
                        return JSON.parse(cleanedLine);
                    } catch (e) {
                        console.warn('JSON 解析失败，跳过该行:', e, cleanedLine);
                        return null; // 解析失败不中断整个流程
                    }
                })
                // 5. 过滤解析失败的 null 值
                .filter(item => item !== null);



            // console.log('找到JSONL数据:', jsonlDataArr);

            // 从JSONL中提取call_id
            try {
                const lines = jsonlDataArr
                console.log('lines', lines);

                let callId = null;


                for (const _key in lines) {
                    const line = lines[_key];
                    // console.log('⭕', line);
                    const obj = line;
                    // console.log('找到obj数据:', obj);
                    if (obj.type === "function_call_start") {
                        callId = obj.call_id;
                        break;
                    }
                }

                if (callId) {
                    // 检查是否已处理过
                    if (processedCallIds.has(callId)) {
                        // console.log(`call_id ${callId} 已处理过，跳过`);
                        return;
                    }

                    // 调用MCP服务
                    callMCPWithJSONRPC(jsonlDataArr, (resultText) => {
                        console.log('MCP调用完成，调用回调函数', resultText);
                        findAndInsertText(resultText);
                    });
                } else {
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
