const { AIMessage } = require("@langchain/core/messages");
const {
    list,
    padroes_verificacao,
    defaultErrorMessage
} = require("./config_files/data_feed")
const {
    START,
    END,
    MessagesAnnotation,
    StateGraph,
    MemorySaver,
} = require("@langchain/langgraph");
const {
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
} = require("./config_model/llm_utils");

/*------------------------------------------------+
|================ MAIN FUNCTION ==================|
+------------------------------------------------*/
const callModel = async state => {
    
    console.log("======= ACIONANDO TRIMMER - ESTABELECENDO VARIÁVEIS DE MEMÓRIA =======\n\n")
    const trimmer = createTrimmer();
    try {
        if (!state.messages?.length) {
            throw new Error("SEM MENSAGENS EM state.messages!");
        }
        const trimmedMessages = trimmer(state.messages);
        const lastMessage = trimmedMessages[trimmedMessages.length - 1].content;
        const recentMessages = trimmedMessages
            .slice(-4)
            .map(msg => msg.content)
            .join("\n");
        
        console.log("======================== INICIANDO FLUXO DE RESPOSTA =========================\n")

        const { orchestratedJson } = await orchestrateInput(lastMessage);
        let parsedOrchestradedJson = JSON.parse(orchestratedJson)
        console.log("\n\n")
        console.log(`RESULTADO: ${orchestratedJson}\n\n`)

        console.log("======= INICIANDO SEPARAÇÃO DE INTENÇÃO POR BLOCO =======")
        const { conversationalMessages, statisticalMessages } = checkOrchestratedJson(parsedOrchestradedJson);
        console.log(`RESULTADO:\nMensagens para o FAISS:${conversationalMessages}\nMensagens para o SQL:${statisticalMessages}\n`)
        
        if (
            conversationalMessages.length > 0 &&
            statisticalMessages.length > 0
        ) {
            console.log("======= DUAS INTENÇÕES DETECTADAS =======");
            let relevantDocs = [];
            let irrelevantMessages = [];
            let dataFound = [];
            if (conversationalMessages) {
                console.log(
                    "======= INICIANDO TRATAMENTO DE INTENÇÃO CONVERSACIONAL =======",
                );
                const { questionArray } = onlyConversationalTreatment(
                    conversationalMessages,
                );
                console.log(
                    "======= PERGUNTAS A SEREM TRATADAS:",
                    conversationalMessages.length,
                );
                console.log(
                    "======= PERGUNTAS QUE SERÃO ENVIADAS PARA O CLASSIFICADOR:",
                    questionArray,
                );
                console.log("======= ENVIANDO PERGUNTAS PARA O CLASSIFICADOR");
                const { relevantMessages, irrelevantMessages: classifiedIrrelevantMessages } =
                    await classifyConversationalMessages(questionArray);
                irrelevantMessages = classifiedIrrelevantMessages;
                console.log("======= CLASSIFICAÇÃO REALIZADA =======");
                console.log("RESULTADO DA CLASSIFICAÇÃO:");
                console.log(
                    "Mensagens Relevantes:",
                    JSON.stringify(relevantMessages, null, 2),
                );
                console.log(
                    "Mensagens Irrelevantes:",
                    JSON.stringify(irrelevantMessages, null, 2),
                );
                relevantDocs = [];
                if (relevantMessages.length > 0) {
                    console.log(
                        "======= INICIANDO GERAÇÃO DE QUERIES PARA O FAISS =======",
                    );
                    const { queries } = await generateFaissQuery(
                        recentMessages,
                        lastMessage,
                        relevantMessages,
                    );
                    console.log("======= QUERIES GERADAS =======");
                    console.log("RESULTADO:", queries);
                    console.log("======= ACIONANDO RETRIEVER =======");
                    const { relevantDocs: docs } = await bringDocsFromFaiss(
                        queries,
                    );
                    relevantDocs = docs;
                    console.log(
                        "======= DOCUMENTOS RELEVANTES RETORNADOS =======",
                    );
                    console.log("RESULTADO:", relevantDocs);
                }
            }
            if (statisticalMessages) {
                console.log(
                    "======= INICIANDO TRATAMENTO DE INTENÇÃO ESTATÍSTICA =======",
                );
                const { questionArray } =
                    onlyStatisticalTreatment(statisticalMessages);
                console.log(
                    "======= PERGUNTAS A SEREM TRATADAS:",
                    statisticalMessages.length,
                );
                console.log(
                    "======= PERGUNTAS QUE SERÃO ENVIADAS PARA O CLASSIFICADOR:",
                    questionArray,
                );
                console.log("======= ENVIANDO PERGUNTAS PARA O CLASSIFICADOR");
                const { classifiedStatisticalMessages } =
                    await classifyStatisticalMessages(questionArray);
                console.log("======= CLASSIFICAÇÃO REALIZADA =======");
                console.log(
                    "RESULTADO DA CLASSIFICAÇÃO:",
                    classifiedStatisticalMessages,
                );
                console.log("======= INICIANDO BUSCA DE DADOS =======");
                dataFound = await handleStatisticalCases(
                    classifiedStatisticalMessages,
                );
                console.log("======= DADOS ENCONTRADOS =======");
                console.log("RESULTADO:", dataFound);
            }
            console.log("======= INICIANDO GERAÇÃO DE RESPOSTA FINAL =======");
            console.log("O QUE SERÁ ENVIADO PARA O MODELO:");
            console.log("MENSAGENS RELEVANTES COM DOCUMENTOS TRAZIDOS:", JSON.stringify(relevantDocs));
            console.log("MENSAGENS IRRELEVANTES:", irrelevantMessages);
            console.log("DADOS ESTATÍSTICOS ENCONTRADOS:", dataFound);
            console.log("Mensagens Recentes:", recentMessages);
            let finalAnswer = await generateFinalAnswer(relevantDocs, irrelevantMessages, dataFound, recentMessages);
            console.log("======= RESPOSTA FINAL GERADA =======");
            console.log("RESULTADO:", finalAnswer);
            return finalAnswer;
        }

        if (statisticalMessages.length === 0) {
            console.log("======= APENAS INTENÇÃO CONVERSACIONAL DETECTADA =======");
            const { questionArray } = onlyConversationalTreatment(conversationalMessages);
            console.log("======= PERGUNTAS A SEREM TRATADAS:", conversationalMessages.length);
            console.log("======= PERGUNTAS QUE SERÃO ENVIADAS PARA O CLASSIFICADOR:", questionArray);
            console.log("======= ENVIANDO PERGUNTAS PARA O CLASSIFICADOR");
            const { relevantMessages, irrelevantMessages } = await classifyConversationalMessages(questionArray);
            console.log("======= CLASSIFICAÇÃO REALIZADA =======")
            console.log("RESULTADO DA CLASSIFICAÇÃO:");
            console.log("Mensagens Relevantes:", JSON.stringify(relevantMessages, null, 2));
            console.log("Mensagens Irrelevantes:", JSON.stringify(irrelevantMessages, null, 2));
            let relevantDocs = [];
            if (relevantMessages.length > 0) {
                console.log("======= INICIANDO GERAÇÃO DE QUERIES PARA O FAISS =======");
                const { queries } = await generateFaissQuery(recentMessages, lastMessage, relevantMessages);
                console.log("======= QUERIES GERADAS =======");
                console.log("RESULTADO:", queries);
                console.log("======= ACIONANDO RETRIEVER =======");
                const { relevantDocs: docs } = await bringDocsFromFaiss(queries);
                relevantDocs = docs;
                console.log("======= DOCUMENTOS RELEVANTES RETORNADOS =======");
                console.log("RESULTADO:", relevantDocs);
            }
            console.log("======= INICIANDO GERAÇÃO DE RESPOSTA FINAL CONVERSACIONAL =======");
            console.log("O QUE SERÁ ENVIADO PARA O MODELO:");
            console.log("MENSAGENS RELEVANTES COM DOCUMENTOS TRAZIDOS:", relevantDocs);
            console.log("MENSAGENS IRRELEVANTES:", irrelevantMessages);
            console.log("Mensagens Recentes:", recentMessages);
            let finalAnswer = await generateConversationalFinalAnswer(
                relevantDocs,
                irrelevantMessages,
                recentMessages,
            );
            console.log("======= RESPOSTA FINAL GERADA =======");
            console.log("RESULTADO:", finalAnswer);
            return finalAnswer;
        }

        if (conversationalMessages.length === 0) {
            console.log("======= APENAS INTENÇÃO ESTATÍSTICA DETECTADA =======");
            const { questionArray } = onlyStatisticalTreatment(statisticalMessages);
            console.log("======= PERGUNTAS A SEREM TRATADAS:", statisticalMessages.length);
            console.log("======= PERGUNTAS QUE SERÃO ENVIADAS PARA O CLASSIFICADOR:", questionArray);
            console.log("======= ENVIANDO PERGUNTAS PARA O CLASSIFICADOR");
            const { classifiedStatisticalMessages } = await classifyStatisticalMessages(questionArray);
            console.log("======= CLASSIFICAÇÃO REALIZADA =======")
            console.log("RESULTADO DA CLASSIFICAÇÃO:", classifiedStatisticalMessages);
            console.log("======= INICIANDO BUSCA DE DADOS =======");
            const dataFound = await handleStatisticalCases(classifiedStatisticalMessages);
            console.log("======= DADOS ENCONTRADOS =======");
            console.log("RESULTADO:", dataFound);
            console.log("======= INICIANDO GERAÇÃO DE RESPOSTA FINAL ESTATÍSTICA =======");
            let finalAnswer = await generateStatisticalFinalAnswer(dataFound, recentMessages);
            console.log("======= RESPOSTA FINAL GERADA =======");
            console.log("RESULTADO:", finalAnswer);
            return finalAnswer;
        } 
        console.log("================================ FIM DE FLUXO =================================")
    } catch (error) {
        console.log("ERRO NA FUNÇÃO PRINCIPAL:", error);
        return {
            messages: [
                new AIMessage({
                    content: defaultErrorMessage,
                }),
            ],
        };
    }
};

/*------------------------------------------------+
|================== SET GRAPH ====================|
+------------------------------------------------*/
const workflow = new StateGraph(MessagesAnnotation)
    .addNode("model", callModel)
    .addEdge(START, "model")
    .addEdge("model", END);

const chatApp = workflow.compile({ checkpointer: new MemorySaver() });

module.exports = { chatApp };
