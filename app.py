from flask import Flask, render_template, jsonify, request
from flask_cors import CORS

app = Flask(__name__)
CORS(app)

@app.route("/")
def index():
    return render_template("index.html")

# Example API route - returns JSON data
@app.route("/api/data", methods=["GET"])
def get_data():
    data = {"message": "Hello from Flask!"}
    return jsonify(data)

# Example route that accepts POST data
@app.route("/api/submit", methods=["POST"])
def submit():
    body = request.get_json()
    print(body)  # Do something with the data
    return jsonify({"status": "received"})

if __name__ == "__main__":
    app.run(debug=True)