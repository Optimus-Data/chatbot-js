require("dotenv").config();
const fs = require("fs");

const path = process.env.PROJECTS_FILE_PATH;

const rawData = fs.readFileSync(path, "utf8");
const parsedData = JSON.parse(rawData);

function findProjects(inputString, parsedData) {
    const projectNumbersAndYears = inputString
        .replace("STAT-PROJ", " ")
        .trim()
        .split(" ");
    const foundEmentas = [];
    for (let i = 0; i < projectNumbersAndYears.length; i++) {
        const projectNumber = projectNumbersAndYears[i];

        for (let j = 0; j < parsedData.length; j++) {
            const vereador = parsedData[j];
            for (let k = 0; k < vereador.projetos.length; k++) {
                const projeto = vereador.projetos[k];
                if (projeto.titulo.includes(projectNumber)) {
                    projectFound = projeto.titulo;
                    getProjectNumber = projectFound.split("Nº");
                    projectFoundNumber = getProjectNumber[1].trim();

                    if (projectNumber === projectFoundNumber) {
                        foundEmentas.push({
                            vereador: vereador.nome,
                            partido: vereador.partido,
                            ...projeto,
                        });
                    }
                }
            }
        }
    }
    if (foundEmentas.length > 0) {
        return foundEmentas;
    } else {
        return [{ "Projetos encontrados": 0 }];
    }
}

function findProjectsByCouncillor(inputString, parsedData) {
    const normalizeText = text => {
        return text
            .toLowerCase()
            .normalize("NFD")
            .replace(/[\u0300-\u036f]/g, "");
    };
    const cleanInput = inputString
        .replace(/^STAT-VERE\s+/i, "")
        .replace(/\s+/g, " ")
        .trim();
    const names = cleanInput.split(/[, ]+/).filter(name => name.trim() !== "");

    const results = [];

    names.forEach(councillorName => {
        if (councillorName) {
            const councillorFound = parsedData.find(vereador =>
                normalizeText(vereador.nome).includes(
                    normalizeText(councillorName),
                ),
            );

            if (councillorFound) {
                results.push(
                    `${councillorFound.nome}: ${councillorFound.projetos.length}`,
                );
            } else {
                results.push(`${councillorName}: 0`);
            }
        }
    });

    return results.join("\n");
}

function findAllProjects(inputString, parsedData) {
    if (inputString.includes("STAT-TOTAL")) {
        let count = 0;
        for (let i = 0; i < parsedData.length; i++) {
            for (let j = 0; j < parsedData[i].projetos.length; j++) {
                if (parsedData[i].projetos[j].ementa) {
                    count++;
                }
            }
        }
        return count;
    }
}

// const result = findProjectsByCouncillor("STAT-VERE adrilles, sandra tadeu", parsedData)
// console.log(result)

module.exports = {
    parsedData,
    findProjects,
    findAllProjects,
    findProjectsByCouncillor,
};
