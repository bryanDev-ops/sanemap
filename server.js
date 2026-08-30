require("dotenv").config();

const express = require("express");
const mysql = require("mysql2");
const cors = require("cors");
const path = require("path");
const bcrypt = require("bcrypt");
const jwt = require("jsonwebtoken");
const multer = require("multer");
const rateLimit = require("express-rate-limit");
const fs = require("fs");

if (!fs.existsSync("uploads")) {
    fs.mkdirSync("uploads");
}

const app = express();
app.set("trust proxy", 1);

const storage = multer.diskStorage({
    destination: (req, file, cb) => {
        cb(null, "uploads/");
    },
    filename: (req, file, cb) => {
        cb(null, Date.now() + "-" + file.originalname);
    }
});

const upload = multer({
    storage: storage,

    limits: {
        fileSize: 5 * 1024 * 1024 // 5MB

    },
    fileFilter: (req, file, cb) => {
        if(file.mimetype.startsWith("image/")){
            cb(null,true);

        }else{
            cb(new Error("Somente imagens são permitidas"));
        }
    }
});

function verificarToken(req,res,next){

    const token = req.headers.authorization;


    if(!token){

        return res.status(401).json({
            mensagem:"Usuário não autenticado"
        });

    }


    const tokenLimpo = token.replace("Bearer ","");


    try{

        const dados = jwt.verify(
            tokenLimpo,
            process.env.JWT_SECRET
        );


        req.usuario = dados;


        next();


    }catch(error){

        return res.status(401).json({
            mensagem:"Token inválido"
        });

    }

}

console.log("SERVIDOR NOVO RODANDO");
console.log("ARQUIVO ATUALIZADO TESTE 123");

app.use(cors());
app.use(express.json());
app.use((req,res,next)=>{

    console.log("REQUISIÇÃO:", req.method, req.url);

    next();

});


// ABRIR SITE
app.get("/", (req,res)=>{

    res.sendFile(
        path.join(__dirname,"ecoviva3.html")
    );

});
app.use(express.static(__dirname));
app.use("/uploads", express.static("uploads"));

// MYSQL
const db = mysql.createConnection({
    host: process.env.DB_HOST,
    user: process.env.DB_USER,
    password: process.env.DB_PASSWORD,
    database: process.env.DB_NAME,
    port: process.env.DB_PORT,
    ssl: {
        rejectUnauthorized: false
    }
});


db.connect((err)=>{

    if(err){

        console.log("ERRO MYSQL:");
        console.log(err);
        return;

    }

    console.log("MySQL conectado");

});


// TESTE BANCO
db.query(
    "SELECT DATABASE() AS banco",
    (err,result)=>{

        if(err){

            console.log(err);
            return;

        }

        console.log(result);

    }
);

// CADASTRO DE USUÁRIO

app.post("/cadastro", async (req,res)=>{

    const {
        nome,
        email,
        senha
    } = req.body;


    if(!nome || !email || !senha){

        return res.status(400).json({
            mensagem:"Preencha todos os campos"
        });

    }


    const senhaHash = await bcrypt.hash(senha,10);


    const sql = `
    INSERT INTO usuarios
    (nome,email,senha)
    VALUES(?,?,?)
    `;


    db.query(
        sql,
        [
            nome,
            email,
            senhaHash
        ],

        (err,result)=>{

            if(err){

                console.log(err);

                return res.status(500).json({
                    mensagem:"Erro ao cadastrar usuário"
                });

            }


            res.json({

                mensagem:"Usuário criado com sucesso!"

            });


        }

    );


});

const loginLimiter = rateLimit({

    windowMs: 15 * 60 * 1000,

    max: 5,

    message: {
        mensagem: "Muitas tentativas de login. Aguarde alguns minutos."
    },

    standardHeaders: true,
    legacyHeaders: false

});

// LOGIN
app.post("/login", loginLimiter, (req,res)=>{

    const {
        email,
        senha
    } = req.body;



    db.query(

        "SELECT * FROM usuarios WHERE email=?",

        [email],

        async (err,result)=>{


            if(err){

                return res.status(500).json(err);

            }


            if(result.length === 0){

                return res.status(404).json({

                    mensagem:"Usuário não encontrado"

                });

            }



            const usuario = result[0];


            const senhaValida =
            await bcrypt.compare(
                senha,
                usuario.senha
            );


            if(!senhaValida){

                return res.status(401).json({

                    mensagem:"Senha incorreta"

                });

            }



            const token = jwt.sign(
                {
                    id:usuario.id,
                    tipo:usuario.tipo
                },

                process.env.JWT_SECRET,

                {
                    expiresIn:"2h"
                }
            );



            res.json({

                mensagem:"Login realizado",

                token,

                usuario:{
                    id:usuario.id,
                    nome:usuario.nome,
                    tipo:usuario.tipo
                }

            });


        }

    );


});

// BUSCAR DENÚNCIAS
app.get("/denuncias",(req,res)=>{

    console.log("ENTROU NA ROTA GET DENUNCIAS");

    const sql =
    "SELECT * FROM denuncias ORDER BY id DESC";


    db.query(sql,(err,result)=>{


        if(err){

            console.log("ERRO MYSQL NO SELECT:");
            console.log(err);


            return res.status(500).json({

                erro:err.message

            });

        }


        console.log("RESULTADO:");
        console.log(result);


        res.json(result);


    });


});


// BUSCAR DENÚNCIAS DO USUÁRIO LOGADO

app.get("/minhas-denuncias", verificarToken, (req,res)=>{


    const usuario_id = req.usuario.id;


    const sql = `

    SELECT *
    FROM denuncias
    WHERE usuario_id=?
    ORDER BY id DESC

    `;


    db.query(

        sql,

        [usuario_id],

        (err,result)=>{


            if(err){

                console.log(err);

                return res.status(500).json({
                    mensagem:"Erro ao buscar denúncias"
                });

            }


            res.json(result);


        }


    );


});

// SALVAR DENÚNCIA
app.post("/denuncias", verificarToken, upload.single("imagem"), (req,res)=>{


    console.log("DADOS RECEBIDOS:");
    console.log(req.body);



    const {

        tipo,
        bairro,
        endereco,
        descricao,
        email

    } = req.body;

    // VALIDAÇÃO DOS CAMPOS
    if(!tipo || !bairro || !endereco || !descricao){
        return res.status(400).json({
        mensagem:"Preencha todos os campos obrigatórios"
        });
        }

    const usuario_id = req.usuario.id;
    const imagem = req.file ? req.file.filename : null;

    const sql = `

        INSERT INTO denuncias
        (
            tipo,
            bairro,
            endereco,
            descricao,
            usuario_id,
            imagem,
            email_contato
        )

        VALUES(?,?,?,?,?,?,?)

    `;



    db.query(

        sql,

        [
            tipo,
            bairro,
            endereco,
            descricao,
            usuario_id,
            imagem,
            email
        ],

        (err,result)=>{


            if(err){

                console.log("ERRO MYSQL NO INSERT:");
                console.log(err);


                return res.status(500).json({

                    erro:err.message

                });

            }



            console.log("DENÚNCIA SALVA");
            console.log(result);



            res.json({

                mensagem:"Denúncia salva com sucesso!",
                id:result.insertId

            });


        }


    );


});

// ALTERAR STATUS DA DENÚNCIA (APENAS ADMIN)

app.put("/denuncias/:id/status", verificarToken, (req,res)=>{


    // verifica se é administrador

    if(req.usuario.tipo !== "admin"){


        return res.status(403).json({

            mensagem:"Apenas administrador pode alterar status"

        });


    }



    const id = req.params.id;

    const {status} = req.body;



    // status permitidos

    const statusPermitidos = [
        "Pendente",
        "Em análise",
        "Concluída"
    ];



    if(!statusPermitidos.includes(status)){


        return res.status(400).json({

            mensagem:"Status inválido"

        });


    }



    const sql = `

    UPDATE denuncias
    SET status = ?
    WHERE id = ?

    `;



    db.query(

        sql,

        [
            status,
            id
        ],


        (err,result)=>{


            if(err){


                console.log(err);


                return res.status(500).json({

                    mensagem:"Erro ao atualizar status"

                });


            }



            res.json({

                mensagem:"Status atualizado com sucesso!"

            });



        }


    );



});

// EXCLUIR DENÚNCIA (APENAS ADMIN)

app.delete("/denuncias/:id", verificarToken, (req,res)=>{


    if(req.usuario.tipo !== "admin"){

        return res.status(403).json({

            mensagem:"Apenas administradores podem excluir denúncias"

        });

    }


    const id = req.params.id;


    const sql =
    "DELETE FROM denuncias WHERE id=?";


    db.query(

        sql,

        [id],

        (err,result)=>{


            if(err){

                console.log(err);


                return res.status(500).json({

                    erro:err.message

                });

            }


            res.json({

                mensagem:"Denúncia excluída!"

            });


        }

    );


});

// TODAS AS DENÚNCIAS PARA ADMIN

app.get("/admin/denuncias", verificarToken, (req,res)=>{


    if(req.usuario.tipo !== "admin"){

        return res.status(403).json({

            mensagem:"Acesso negado"

        });

    }


    const sql = `

    SELECT *
    FROM denuncias
    ORDER BY id DESC

    `;


    db.query(sql,(err,result)=>{


        if(err){

            return res.status(500).json(err);

        }


        res.json(result);


    });


});

app.get("/estatisticas", (req, res) => {

    const sql = `
        SELECT
            (SELECT COUNT(*) FROM denuncias) AS denuncias,
            (SELECT COUNT(*) FROM usuarios) AS usuarios,
            (SELECT COUNT(DISTINCT bairro) FROM denuncias) AS bairros,
            (SELECT COUNT(*) FROM denuncias WHERE status='Concluída') AS concluidas,
            (SELECT COUNT(*) FROM denuncias WHERE status='Pendente') AS pendentes,
            (SELECT COUNT(*) FROM denuncias WHERE status='Em análise') AS analise
    `;

    db.query(sql, (err, result) => {

        if (err) {

            console.log(err);

            return res.status(500).json({
                mensagem: "Erro ao buscar estatísticas"
            });

        }

        res.json(result[0]);

    });

});

// DADOS PARA MAPA POR BAIRRO

app.get("/mapa-denuncias", (req,res)=>{


    const sql = `

    SELECT 
        bairro,
        COUNT(*) AS quantidade

    FROM denuncias

    GROUP BY bairro

    ORDER BY quantidade DESC

    `;


    db.query(sql,(err,result)=>{


        if(err){

            console.log(err);

            return res.status(500).json({
                mensagem:"Erro ao buscar dados do mapa"
            });

        }


        res.json(result);


    });


});

// SERVIDOR
app.listen(

    3000,

    "0.0.0.0",

    ()=>{

        console.log(
            "Servidor rodando em http://localhost:3000"
        );

    }

);