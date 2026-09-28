package main

import (
    "bytes"
    "crypto/rand"
    "encoding/base64"
    "encoding/binary"
    "encoding/json"
    "fmt"
    "image/jpeg"
    "io"
    "log"
    "net/http"
    "os"
    "os/exec"
    "path/filepath"
    "strings"
    "time"
)

const host = "127.0.0.1"
const port = "8765"
var inbox string

type Result struct { ID string `json:"id"`; Filename string `json:"filename"`; Path string `json:"path"`; Size int64 `json:"size"`; CreatedAt string `json:"created_at"`; DownloadURL string `json:"download_url"` }

func cors(w http.ResponseWriter) { w.Header().Set("Access-Control-Allow-Origin", "*"); w.Header().Set("Access-Control-Allow-Headers", "Content-Type"); w.Header().Set("Access-Control-Allow-Methods", "GET,POST,OPTIONS") }
func jsonResponse(w http.ResponseWriter, status int, v any) { cors(w); w.Header().Set("Content-Type", "application/json; charset=utf-8"); w.WriteHeader(status); _ = json.NewEncoder(w).Encode(v) }
func randomID() string { b:=make([]byte,16); if _,err:=rand.Read(b);err!=nil{return fmt.Sprintf("%d",time.Now().UnixNano())}; return fmt.Sprintf("%x",b) }
func utf16LE(s string) []byte { r:=[]rune(s); out:=make([]byte,len(r)*2); for i,c:=range r { binary.LittleEndian.PutUint16(out[i*2:],uint16(c)) }; return out }

func runWIA(jpg string) error {
    ps:=fmt.Sprintf(`$d=New-Object -ComObject WIA.CommonDialog; $img=$d.ShowAcquireImage(); if ($null -eq $img) { exit 2 }; $img.SaveFile('%s')`,strings.ReplaceAll(jpg,"'","''"))
    enc:=base64.StdEncoding.EncodeToString(utf16LE(ps))
    cmd:=exec.Command("powershell.exe","-NoProfile","-ExecutionPolicy","Bypass","-STA","-EncodedCommand",enc)
    out,err:=cmd.CombinedOutput()
    if err!=nil { if strings.Contains(string(out),"2"){return fmt.Errorf("сканування скасовано")}; return fmt.Errorf("WIA: %v: %s",err,strings.TrimSpace(string(out))) }
    if _,err:=os.Stat(jpg);err!=nil{return fmt.Errorf("сканер не створив файл: %v",err)}
    return nil
}

func makePDF(jpgPath,pdfPath string) error {
    f,err:=os.Open(jpgPath);if err!=nil{return err};defer f.Close()
    img,err:=jpeg.DecodeConfig(f);if err!=nil{return err};if _,err=f.Seek(0,io.SeekStart);err!=nil{return err};data,err:=io.ReadAll(f);if err!=nil{return err}
    wpt:=float64(img.Width)*72/300;hpt:=float64(img.Height)*72/300
    var b bytes.Buffer;b.WriteString("%PDF-1.4\n%\xE2\xE3\xCF\xD3\n");offsets:=[]int{0}
    obj:=func(n int,s string){offsets=append(offsets,b.Len());fmt.Fprintf(&b,"%d 0 obj\n%s\nendobj\n",n,s)}
    obj(1,"<< /Type /Catalog /Pages 2 0 R >>");obj(2,"<< /Type /Pages /Kids [3 0 R] /Count 1 >>")
    obj(3,fmt.Sprintf("<< /Type /Page /Parent 2 0 R /MediaBox [0 0 %.2f %.2f] /Resources << /XObject << /Im0 5 0 R >> >> /Contents 4 0 R >>",wpt,hpt))
    content:=fmt.Sprintf("q\n%.2f 0 0 %.2f 0 0 cm\n/Im0 Do\nQ\n",wpt,hpt);obj(4,fmt.Sprintf("<< /Length %d >>\nstream\n%sendstream",len(content),content))
    offsets=append(offsets,b.Len());fmt.Fprintf(&b,"5 0 obj\n<< /Type /XObject /Subtype /Image /Width %d /Height %d /ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /DCTDecode /Length %d >>\nstream\n",img.Width,img.Height,len(data));b.Write(data);b.WriteString("\nendstream\nendobj\n")
    xref:=b.Len();b.WriteString("xref\n0 6\n0000000000 65535 f \n");for i:=1;i<=5;i++{fmt.Fprintf(&b,"%010d 00000 n \n",offsets[i])};fmt.Fprintf(&b,"trailer\n<< /Size 6 /Root 1 0 R >>\nstartxref\n%d\n%%%%EOF\n",xref)
    return os.WriteFile(pdfPath,b.Bytes(),0644)
}

func health(w http.ResponseWriter,r *http.Request){jsonResponse(w,200,map[string]any{"ok":true,"agent":"PSK Scanner Agent","version":"1.0.0","scanner":"Canon MF212w","port":8765})}
func scan(w http.ResponseWriter,r *http.Request){if r.Method!=http.MethodPost{jsonResponse(w,405,map[string]any{"ok":false,"error":"POST required"});return};id:=randomID();jpg:=filepath.Join(inbox,id+".jpg");pdf:=filepath.Join(inbox,id+".pdf");if err:=runWIA(jpg);err!=nil{jsonResponse(w,500,map[string]any{"ok":false,"error":err.Error()});return};if err:=makePDF(jpg,pdf);err!=nil{jsonResponse(w,500,map[string]any{"ok":false,"error":err.Error()});return};_=os.Remove(jpg);st,_:=os.Stat(pdf);res:=Result{ID:id,Filename:id+".pdf",Path:pdf,Size:st.Size(),CreatedAt:time.Now().Format(time.RFC3339),DownloadURL:"http://"+host+":"+port+"/file?id="+id};jsonResponse(w,200,map[string]any{"ok":true,"document":res})}
func fileHandler(w http.ResponseWriter,r *http.Request){id:=r.URL.Query().Get("id");if id==""||strings.ContainsAny(id,`/\\`){jsonResponse(w,400,map[string]any{"error":"Невірний id"});return};p:=filepath.Join(inbox,id+".pdf");data,err:=os.ReadFile(p);if err!=nil{jsonResponse(w,404,map[string]any{"error":"Файл не знайдено"});return};cors(w);w.Header().Set("Content-Type","application/pdf");w.Header().Set("Content-Disposition",fmt.Sprintf(`inline; filename="%s.pdf"`,id));w.WriteHeader(200);_,_=w.Write(data)}
func main(){root:=os.Getenv("PROGRAMDATA");if root==""{root=os.TempDir()};inbox=filepath.Join(root,"PSK_Scanner_Agent","inbox");if err:=os.MkdirAll(inbox,0755);err!=nil{log.Fatal(err)};http.HandleFunc("/health",health);http.HandleFunc("/scan",scan);http.HandleFunc("/file",fileHandler);http.HandleFunc("/info",func(w http.ResponseWriter,r *http.Request){jsonResponse(w,200,map[string]any{"ok":true,"scanner":"Canon MF212w","protocol":"WIA","inbox":inbox})});log.Printf("PSK Scanner Agent listening on http://%s:%s",host,port);log.Fatal(http.ListenAndServe(host+":"+port,nil))}
