// Chatbot da Câmara Municipal de São Paulo
// (c) 2025 Optimus Data Technology - Uso permitido apenas para estudos
// Contato: claudinei.goncalves@optimusdata.com.br | (11) 98185-5447

require('dotenv').config();
const express = require('express');
const bodyParser = require('body-parser');
const routes = require('./routes/routes.js');


const app = express();
app.use(bodyParser.json());
app.use('/api', routes);


const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`Servidor rodando na porta ${PORT}`);
});
