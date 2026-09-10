from flask import Flask

app = Flask(__name__)

@app.route("/")
def index():
    return """
    <!doctype html>
    <html>
    <head>
        <title>Test Page</title>
        <style>
            body {
                background-color: blue;
                color: red;
                font-family: sans-serif;
                font-size: 48px;
                display: flex;
                align-items: center;
                justify-content: center;
                height: 100vh;
                margin: 0;
            }
        </style>
    </head>
    <body>
        Hello Flask
    </body>
    </html>
    """

if __name__ == "__main__":
    app.run(debug=True, port=5000)
