import 'dotenv/config'


const HOST = process.env.HOST || 'localhost'
const PORT = process.env.PORT ? +process.env.PORT || 3000 : 3000

import express from 'express'
import bodyParser from 'body-parser'

const app = express()


app.use(bodyParser.json())
app.use(bodyParser.urlencoded({ extended: true }))

app.use((req, res, next) => {
    res.setHeader("Cross-Origin-Opener-Policy", "same-origin");
    res.setHeader("Cross-Origin-Embedder-Policy", "require-corp");
    next();
});

app.use(express.static('./frontend/src')) // For development
// app.use(express.static('./frontend/dist')) // For production


// Return empty response for favicon
app.get('/favicon.ico', (req, res) => { res.status(204).end() })

// Default 404
app.use((req, res) => {
    res.status(404).end()
})

app.listen(PORT, HOST, () => {
    console.log(`VovkPLCEditor Server listening on http://${HOST}:${PORT}`)
})

