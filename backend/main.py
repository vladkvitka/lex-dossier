from fastapi import FastAPI

app = FastAPI()

@app.get("/")
def root():
    return {"status": "ok", "message": "Лекс.Досье backend работает"}

@app.get("/health")
def health():
    return {"status": "healthy"}
