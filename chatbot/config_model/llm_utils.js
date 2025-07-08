const { ChatOpenAI, convertPromptToOpenAI } = require("@langchain/openai");
const { loadRetrieverFromStore } = require("./db_utils.js");
const { AIMessage } = require("@langchain/core/messages");
const fs = require("fs/promises");
const path = require("path");
const {
    parsedData,
    findProjects,
    findAllProjects,
    findProjectsByCouncillor,
} = require("../config_files/file_operations.js");
const {
    config,
    list,
    padroes_verificacao,
    url,
    defaultErrorMessage,
    defaultDataError,
} = require("../config_files/data_feed.js");
const {
    orchestratorPrompt,
    conversationalClassifierPrompt,
    retrievalPrompt,
    conversationalPrompt,
    statisticalClassifierPrompt,
    statisticalPrompt,
    generalAnswerPrompt,
} = require("./prompt_templates.js");
const { cat } = require("@huggingface/transformers");

/*-----------------------------------------------+
|============== SOME GLOBAL INFO ================|
+------------------------------------------------*/
const LOGS_PATH = path.join(
    __dirname,
    "..",
    "..",
    "logs",
    "logs_no_retriever.json",
);
const LOGS_RETRIEVER_PATH = path.join(
    __dirname,
    "..",
    "..",
    "logs",
    "logs_retriever.json",
);
const QUERY_PATH = path.join(
    __dirname,
    "..",
    "..",
    "logs",
    "query_retriever.json",
);
const RELEVANCE_PATH = path.join(
    __dirname,
    "..",
    "..",
    "logs",
    "relevance_retriever.json",
);
/*-----------------------------------------------+
|============== SETUP LLMs/SLMs =================|
+------------------------------------------------*/
const llm = new ChatOpenAI({
    model: "gpt-4o",
    temperature: 0,
});

const orchestrator_llm = new ChatOpenAI({
    model: "gpt-4o",
    temperature: 0.2,
});

const retrieval_llm = new ChatOpenAI({
    model: "gpt-3.5-turbo-0125",
    temperature: 0,
});

const classifier_llm = new ChatOpenAI({
    model: "gpt-3.5-turbo-0125",
    temperature: 0,
});

/*------------------------------------------------+
|================== FUNCTIONS ====================|
+------------------------------------------------*/

// ========== TRIMMER - MEMORY HANDLING ========== \\
const createTrimmer = () => {
    return messages => {
        if (messages.length <= 800) return messages;
        return messages.slice(-800);
    };
};

// ========== RETRIEVER - LOADING RETRIEVER ========== \\
let retriever;
loadRetrieverFromStore()
    .then(r => {
        retriever = r;
    })
    .catch(err => {
        console.error("Failed to load retriever:", err);
    });

// ========== LOGS - SOME USEFUL DEBUG FUNCTIONS ========== \\
async function saveAnalysis(analysisData, relevance) {
    let analyses = [];
    if (relevance === "true") {
        try {
            try {
                const fileContent = await fs.readFile(QUERY_PATH, "utf-8");
                analyses = JSON.parse(fileContent);
            } catch (error) {
                if (error.code !== "ENOENT") throw error;
            }
            analyses.push({
                timestamp: new Date().toISOString(),
                ...analysisData,
            });
            await fs.writeFile(QUERY_PATH, JSON.stringify(analyses, null, 2));
        } catch (error) {
            console.error("Erro ao salvar análise:", error);
        }
    } else {
        try {
            try {
                const fileContent = await fs.readFile(RELEVANCE_PATH, "utf-8");
                analyses = JSON.parse(fileContent);
            } catch (error) {
                if (error.code !== "ENOENT") throw error;
            }
            analyses.push({
                timestamp: new Date().toISOString(),
                ...analysisData,
            });
            await fs.writeFile(
                RELEVANCE_PATH,
                JSON.stringify(analyses, null, 2),
            );
        } catch (error) {
            console.error("Erro ao salvar análise:", error);
        }
    }
}

async function saveLog(logData, relevance) {
    let logs = [];
    if (relevance === "false") {
        try {
            try {
                const fileContent = await fs.readFile(LOGS_PATH, "utf-8");
                logs = JSON.parse(fileContent);
            } catch (error) {
                if (error.code !== "ENOENT") throw error;
            }
            logs.push({
                timestamp: new Date().toISOString(),
                ...logData,
            });
            await fs.writeFile(LOGS_PATH, JSON.stringify(logs, null, 2));
        } catch (error) {
            console.error("Erro ao salvar log:", error);
        }
    } else {
        try {
            try {
                const fileContent = await fs.readFile(
                    LOGS_RETRIEVER_PATH,
                    "utf-8",
                );
                logs = JSON.parse(fileContent);
            } catch (error) {
                if (error.code !== "ENOENT") throw error;
            }
            logs.push({
                timestamp: new Date().toISOString(),
                ...logData,
            });
            await fs.writeFile(
                LOGS_RETRIEVER_PATH,
                JSON.stringify(logs, null, 2),
            );
        } catch (error) {
            console.error("Erro ao salvar log:", error);
        }
    }
}

// ========== FUNCTION - ORCHESTRATION ========== \\
const orchestrateInput = async lastMessage => {
    let orchestratedJson;
    try {
        const orchestrateAnswer = await orchestrator_llm.invoke([
            {
                role: "system",
                content: `O seu prompt de instruções: ${orchestratorPrompt}\n\n
                CLASSIFIQUE ESSE INPUT: ${lastMessage}\n\n`,
            },
        ]);
        orchestratedJson = orchestrateAnswer.content;
    } catch (error) {
        console.error(
            "ERRO AO ORQUESTRAR INPUT | FALLBACK | MENSAGEM DE ERRO:",
            error,
        );
        orchestratedJson = JSON.stringify([
            {
                perguntas: [
                    {
                        tipo: "tipo_vetorial",
                        texto: lastMessage,
                    },
                ],
            },
        ]);
    }
    return { orchestratedJson };
};

// ========== FUNCTION - CONVERSATIONAL INPUT TREATMENT ========== \\
function checkOrchestratedJson(parsedInput) {
    const conversationalMessages = [];
    const statisticalMessages = [];
    for (let i = 0; i < parsedInput.length; i++) {
        let property = parsedInput[i].perguntas;
        for (let j = 0; j < property.length; j++) {
            if (property[j].tipo === "tipo_vetorial") {
                conversationalMessages.push(property[j].texto);
            }
            if (property[j].tipo === "tipo_banco") {
                statisticalMessages.push(property[j].texto);
            }
        }
    }
    return { conversationalMessages, statisticalMessages };
}

function onlyConversationalTreatment(conversationalMessages) {
    let questionArray = [];
    if (conversationalMessages.length > 1) {
        for (let i = 0; i < conversationalMessages.length; i++) {
            let obj = {
                question: conversationalMessages[i],
            };
            questionArray.push(obj);
        }
        return { questionArray };
    } else {
        let obj = {
            question: conversationalMessages.join(" "),
        };
        questionArray.push(obj);
        return { questionArray };
    }
}

const classifyConversationalMessages = async questionArray => {
    let relevance = "true";
    let relevantMessages = [];
    let irrelevantMessages = [];
    try {
        if (questionArray.length === 1) {
            const classifierAnswer = await classifier_llm.invoke([
                {
                    role: "system",
                    content: `Seu prompt de instruções: ${conversationalClassifierPrompt}\n
                    CLASSIFIQUE ESSA MENSAGEM: ${questionArray[0].question}\n`,
                },
            ]);
            relevance = classifierAnswer.content?.trim().toLowerCase();
            if (relevance === "true") {
                relevantMessages.push(questionArray[0].question);
            } else {
                irrelevantMessages.push(questionArray[0].question);
            }
        } else {
            for (let i = 0; i < questionArray.length; i++) {
                const classifierAnswer = await classifier_llm.invoke([
                    {
                        role: "system",
                        content: `Seu prompt de instruções: ${conversationalClassifierPrompt}\n
                        A mensagem que você deve classificar é: ${questionArray[i].question}\n`,
                    },
                ]);
                relevance = classifierAnswer.content?.trim().toLowerCase();
                if (relevance === "true") {
                    relevantMessages.push(questionArray[i].question);
                } else {
                    irrelevantMessages.push(questionArray[i].question);
                }
            }
        }
    } catch (error) {
        console.error(
            "ERRO AO CLASSIFICAR MENSAGENS CONVERSACIONAIS | FALLBACK. MENSAGEM DE ERRO:",
            error,
        );
        for (let i = 0; i < questionArray.length; i++) {
            relevantMessages.push(questionArray[i].question);
        }
    }
    return { relevantMessages, irrelevantMessages };
};

const generateFaissQuery = async (
    recentMessages,
    lastMessage,
    relevantMessages,
) => {
    let query = lastMessage;
    let queries = [];
    try {
        if (relevantMessages.length === 1) {
            let modelAnswer = await retrieval_llm.invoke([
                {
                    role: "system",
                    content: `Esse é o seu prompt de instruções: ${retrievalPrompt}\n
                    Esse é o contexto recente de interações, use-o para pegar referências mencionadas anteriormente, caso seja necessário: ${JSON.stringify(
                        recentMessages,
                        null,
                        2,
                    )}\n
                    TRANSFORME ESSA MENSAGEM EM UMA QUERY: ${
                        relevantMessages[0]
                    }\n`,
                },
            ]);
            query = modelAnswer.content;
            let obj = {
                question: relevantMessages[0],
                query: query,
            };
            queries.push(obj);
        }
        if (relevantMessages.length > 1) {
            for (let i = 0; i < relevantMessages.length; i++) {
                let modelAnswer = await retrieval_llm.invoke([
                    {
                        role: "system",
                        content: `Esse é o seu prompt de instruções: ${retrievalPrompt}\n
                        Esse é o contexto recente de interações, use-o para pegar referências mencionadas anteriormente, caso seja necessário: ${JSON.stringify(
                            recentMessages,
                            null,
                            2,
                        )}\n
                        TRANSFORME ESSA MENSAGEM EM UMA QUERY: ${
                            relevantMessages[i]
                        }\n`,
                    },
                ]);
                query = modelAnswer.content;
                let obj = {
                    question: relevantMessages[i],
                    query: query,
                };
                queries.push(obj);
            }
        }
    } catch (error) {
        console.error(
            "ERRO AO GERAR QUERY PARA O FAISS, FALLBACK DA VARIÁVEL query PARA lastMessage. MENSAGEM DE ERRO:",
            error,
        );
        let obj = {
            question: lastMessage,
            query: lastMessage,
        };
        queries.push(obj);
    }
    return { queries };
};

const bringDocsFromFaiss = async queries => {
    let relevantDocs = [];
    let docs = [];
    try {
        if (queries.length === 1) {
            if (padroes_verificacao.includes(queries[0].query)) {
                let obj = {
                    question: queries[0].question,
                    docs: list,
                };
                relevantDocs.push(obj);
            } else {
                docs = await retriever.getRelevantDocuments(queries[0].query);
                let obj = {
                    question: queries[0].question,
                    docs: docs,
                };
                relevantDocs.push(obj);
            }
        }
        if (queries.length > 1) {
            for (let i = 0; i < queries.length; i++) {
                if (padroes_verificacao.includes(queries[i].query)) {
                    let obj = {
                        question: queries[i].question,
                        docs: list,
                    };
                    relevantDocs.push(obj);
                    continue;
                } else {
                    docs = await retriever.getRelevantDocuments(
                        queries[i].query,
                    );
                    let obj = {
                        question: queries[i].question,
                        docs: docs,
                    };
                    relevantDocs.push(obj);
                }
            }
        }
    } catch (error) {
        console.error(
            "ERRO AO TRAZER DADOS DO FAISS, FALLBACK. MENSAGEM DE ERRO:",
            error,
        );
        for (let i = 0; i < queries.length; i++) {
            let obj = {
                question: queries[i].question,
                docs: [],
            };
            relevantDocs.push(obj);
        }
    }
    return { relevantDocs };
};

const generateConversationalFinalAnswer = async (
    relevantDocs,
    irrelevantMessages,
    recentMessages,
) => {
    let answerText = defaultErrorMessage;
    try {
        let modelAnswer = await llm.invoke([
            {
                role: "system",
                content: `Esse é o seu prompt de instruções: ${conversationalPrompt}\n\n
MENSAGENS RECENTES: ${JSON.stringify(recentMessages, null, 2)}\n
MENSAGENS IRRELEVANTES AO ESCOPO: ${JSON.stringify(
                    irrelevantMessages,
                    null,
                    2,
                )}\n
MENSAGENS RELEVANTES COM OS RESPECTIVOS DOCUMENTOS TRAZIDOS PELO RETRIEVER: ${JSON.stringify(
                    relevantDocs,
                    null,
                    2,
                )}`,
            },
        ]);
        answerText = modelAnswer.content;
        if (
            answerText.includes("Note:") ||
            answerText.includes("provided context")
        ) {
            answerText = answerText.split("\n\n")[0];
        }
    } catch (error) {
        console.error(
            "ERRO AO GERAR A RESPOSTA FINAL NA FUNÇÃO generateConversationalFinalAnswer | FALLBACK DE answerText PARA MENSAGEM PADRONIZADA. MENSAGEM DE ERRO:",
            error,
        );
    }
    return { messages: [new AIMessage({ content: answerText })] };
};

// ========== FUNCTION - STATISTICAL INPUT TREATMENT ========== \\
function onlyStatisticalTreatment(statisticalMessages) {
    let questionArray = [];
    if (statisticalMessages.length > 1) {
        for (let i = 0; i < statisticalMessages.length; i++) {
            let obj = {
                question: statisticalMessages[i],
            };
            questionArray.push(obj);
        }
        return { questionArray };
    } else {
        let obj = {
            question: statisticalMessages.join(" "),
        };
        questionArray.push(obj);
        return { questionArray };
    }
}

const classifyStatisticalMessages = async questionArray => {
    let stat = "";
    let classifiedStatisticalMessages = [];
    try {
        if (questionArray.length === 1) {
            const classifierAnswer = await classifier_llm.invoke([
                {
                    role: "system",
                    content: `Esse é o seu prompt de instruções: ${statisticalClassifierPrompt}\n
                    CLASSIFIQUE ESSA MENSAGEM: ${questionArray[0].question}\n`,
                },
            ]);
            stat = classifierAnswer.content;
            let obj = {
                question: questionArray[0].question,
                stat: stat,
            };
            classifiedStatisticalMessages.push(obj);
        }
        if (questionArray.length > 1) {
            for (let i = 0; i < questionArray.length; i++) {
                const classifierAnswer = await classifier_llm.invoke([
                    {
                        role: "system",
                        content: `Esse é o seu prompt de instruções: ${statisticalClassifierPrompt}\n
                        CLASSIFIQUE ESSA MENSAGEM: ${questionArray[i].question}\n`,
                    },
                ]);
                stat = classifierAnswer.content;
                let obj = {
                    question: questionArray[i].question,
                    stat: stat,
                };
                classifiedStatisticalMessages.push(obj);
            }
        }
    } catch (error) {
        console.error(
            "ERRO AO CLASSIFICAR MENSAGENS ESTATÍSTICAS | FALLBACK. MENSAGEM DE ERRO:",
            error,
        );
        for (let i = 0; i < questionArray.length; i++) {
            let obj = {
                question: questionArray[i].question,
                stat: "nenhum dado encontrado",
            };
            classifiedStatisticalMessages.push(obj);
        }
    }
    return { classifiedStatisticalMessages };
};

const handleStatisticalCases = async classifiedStatisticalMessages => {
    let dataFound = [];
    try {
        for (let i = 0; i < classifiedStatisticalMessages.length; i++) {
            if (classifiedStatisticalMessages[i].stat.includes("STAT-PROJ")) {
                const projects = findProjects(
                    classifiedStatisticalMessages[i].stat,
                    parsedData,
                );
                if (projects) {
                    let obj = {
                        question: classifiedStatisticalMessages[i].question,
                        data: projects,
                    };
                    dataFound.push(obj);
                }
            }
            if (classifiedStatisticalMessages[i].stat.includes("STAT-VERE")) {
                const councillors = findProjectsByCouncillor(
                    classifiedStatisticalMessages[i].stat,
                    parsedData,
                );
                if (councillors) {
                    let obj = {
                        question: classifiedStatisticalMessages[i].question,
                        data: councillors,
                    };
                    dataFound.push(obj);
                }
            }
            if (classifiedStatisticalMessages[i].stat.includes("STAT-TOTAL")) {
                const total = findAllProjects(
                    classifiedStatisticalMessages[i].stat,
                    parsedData,
                );
                if (total) {
                    let obj = {
                        question: classifiedStatisticalMessages[i].question,
                        data: total,
                    };
                    dataFound.push(obj);
                }
            }
        }
    } catch (error) {
        console.error(
            "ERRO AO MANIPULAR CASOS ESTATÍSTICOS | FALLBACK. MENSAGEM DE ERRO:",
            error,
        );
        for (let i = 0; i < classifiedStatisticalMessages.length; i++) {
            let obj = {
                question: classifiedStatisticalMessages[i].question,
                data: "nenhum dado encontrado",
            };
            dataFound.push(obj);
        }
    }
    return dataFound;
};

const generateStatisticalFinalAnswer = async (dataFound, recentMessages) => {
    let answerText = defaultDataError;
    try {
        let modelAnswer = await llm.invoke([
            {
                role: "system",
                content: `Esse é o seu prompt de instruções: ${statisticalPrompt}\n
                MENSAGENS RECENTES: ${JSON.stringify(recentMessages, null, 2)}\n
                MENSAGENS ESTATÍSTICAS COM O CONTEÚDO RETORNADO PELO BANCO: ${JSON.stringify(
                    dataFound,
                    null,
                    2,
                )}`,
            },
        ]);
        answerText = modelAnswer.content;
        if (
            answerText.includes("Note:") ||
            answerText.includes("provided context")
        ) {
            answerText = answerText.split("\n\n")[0];
        }
    } catch (error) {
        console.error(
            "ERRO AO GERAR A RESPOSTA FINAL NA FUNÇÃO generateStatisticalFinalAnswer | FALLBACK DE answerText PARA MENSAGEM PADRONIZADA. MENSAGEM DE ERRO:",
            error,
        );
    }
    return {
        messages: [new AIMessage({ content: answerText })],
    };
};

// ========== FUNCTION - GENERATE FINAL ANSWER ´BOTH CASES´ ========== \\
const generateFinalAnswer = async (
    relevantDocs,
    irrelevantMessages,
    dataFound,
    recentMessages,
) => {
    let answerText = defaultErrorMessage;
    try {
        let modelAnswer = await llm.invoke([
            {
                role: "system",
                content: `Esse é o seu prompt de instruções: ${generalAnswerPrompt}\n
                MENSAGENS RELEVANTES COM OS RESPECTIVOS DOCUMENTOS TRAZIDOS: ${JSON.stringify(
                    relevantDocs,
                    null,
                    2,
                )}\n
                MENSAGENS IRRELEVANTES AO ESCOPO: ${JSON.stringify(
                    irrelevantMessages,
                    null,
                    2,
                )}\n
                **IMPORTANTE | NÃO IGNORE** MENSAGENS ESTATÍSTICAS OU SOBRE ALGUM PROJETO ESPECÍFICO COM OS RESPECTIVOS CONTEÚDOS RETORNADOS PELO BANCO: ${JSON.stringify(
                    dataFound,
                    null,
                    2,
                )}\n
                MENSAGENS RECENTES: ${JSON.stringify(recentMessages, null, 2)}`,
            },
        ]);
        answerText = modelAnswer.content;
        if (
            answerText.includes("Note:") ||
            answerText.includes("provided context")
        ) {
            answerText = answerText.split("\n\n")[0];
        }
    } catch (error) {
        console.error(
            "ERRO AO GERAR A RESPOSTA FINAL NA FUNÇÃO generateFinalAnswer | FALLBACK DE answerText PARA MENSAGEM PADRONIZADA. MENSAGEM DE ERRO:",
            error,
        );
    }
    return {
        messages: [new AIMessage({ content: answerText })],
    };
};

module.exports = {
    createTrimmer,
    orchestrateInput,
    checkOrchestratedJson,
    onlyConversationalTreatment,
    classifyConversationalMessages,
    generateFaissQuery,
    bringDocsFromFaiss,
    generateConversationalFinalAnswer,
    onlyStatisticalTreatment,
    classifyStatisticalMessages,
    handleStatisticalCases,
    generateStatisticalFinalAnswer,
    generateFinalAnswer,
};
