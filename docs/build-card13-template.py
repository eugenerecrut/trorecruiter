"""Recreate the user's two-page Appendix 13 scan as a clean, fillable A4 blank."""
from pathlib import Path
from reportlab.pdfgen import canvas
from reportlab.lib.pagesizes import A4
from reportlab.lib.units import mm
from reportlab.pdfbase import pdfmetrics
from reportlab.pdfbase.ttfonts import TTFont
from reportlab.lib.colors import black, white
from pypdf import PdfReader, PdfWriter
from pypdf.generic import NameObject, DecodedStreamObject
from io import BytesIO

ROOT = Path(__file__).resolve().parent.parent
FONT = ROOT / 'templates/fonts/Tinos-Regular.ttf'
pdfmetrics.registerFont(TTFont('FormText', str(FONT)))
OUT = ROOT / 'templates/card13-blank.pdf'
c = canvas.Canvas(str(OUT), pagesize=A4)
c.setTitle('Додаток 13. Картка обстеження та медичного огляду')
c.setAuthor('PSK_RECRUTER CRM')
W,H = A4

def text(x,y,s,size=10.5):
    c.setFont('FormText',size); c.setFillColor(black)
    c.drawString(x*mm,y*mm,s)
def center(y,s,size=10.5):
    c.setFont('FormText',size); c.drawCentredString(W/2,y*mm,s)
def signature_caption(y):
    c.setFont('FormText',9.5)
    c.drawCentredString(119*mm,y*mm,'(військове звання, підпис, власне ім’я та прізвище)')
def line(x,y,w):
    c.setLineWidth(.45);c.line(x*mm,y*mm,(x+w)*mm,y*mm)
def field(name,x,y,w,h=6,multiline=False,value=''):
    c.acroForm.textfield(name=name,x=x*mm,y=y*mm,width=w*mm,height=h*mm,
        value='',fontName='Helvetica',fontSize=10,borderWidth=0,
        fillColor=white,textColor=black,forceBorder=False,
        fieldFlags='multiline' if multiline else '',maxlen=1200)
    if value:
        for i,s in enumerate(value.split('\n')):text(x+1,y+h-4-i*4,s,9)
def table(top,rows,columns,header=None):
    x=17; width=sum(columns);y=top
    has_header=bool(header)
    if has_header:
        rows=[(header,18)]+rows
    for row_index,(cells,height) in enumerate(rows):
        c.setLineWidth(.45); c.rect(x*mm,(y-height)*mm,width*mm,height*mm)
        cur=x
        for j,col in enumerate(columns):
            if j:c.line(cur*mm,y*mm,cur*mm,(y-height)*mm)
            parts=str(cells[j] if j<len(cells) else '').split('\n')
            leading=4.5
            is_header=has_header and row_index==0
            start=y-height/2+(len(parts)-1)*leading/2-1.2 if is_header or len(parts)==1 else y-4.5
            for k,part in enumerate(parts):
                if is_header:
                    c.setFont('FormText',10.5)
                    c.drawCentredString((cur+col/2)*mm,(start-k*leading)*mm,part)
                else:text(cur+2,start-k*leading,part,10.5)
            cur+=col
        y-=height
    return y

# Front: identifying information and the first part of the investigation table.
text(113,282,'Додаток 13')
text(113,277,'до Положення про військово-лікарську')
text(113,272,'експертизу в Збройних Силах України')
text(113,267,'(пункт 5.1 глави 5 розділу II)')
text(17,257,'Місце для фотокартки')
text(17,252,'(фото 3×4 см без головного убору)')
text(17,247,'М. П.')
center(241,'КНП «МКЛ № 6» ДМР',11)
line(17,238,176)
center(234,'(найменування закладу охорони здоров’я)',9.5)
center(227,'Картка',12)
center(221,'обстеження та медичного огляду',12)
field('category',17,215,176)
text(18,210,'Визначення придатності до військової служби')
line(17,208,176)
center(205,'(вказати категорію особи, що оглядається, та мету медичного огляду)',9.5)
text(17,201,'1. Прізвище, ім’я, по батькові (за наявності), РНОКПП (серія (за наявності) та номер паспорта для')
text(17,196,'осіб, які відмовились від РНОКПП відповідно до закону)')
field('name_identifier',17,184,176,12,True)
line(17,190,176);line(17,184,176)
text(17,179,'2. Дата народження (у форматі «число, місяць, рік»)',10.5)
field('birth_date',110,177.2,83);line(110,177.5,83)
text(17,173,'3. Військове звання',10.5);field('military_rank',54,171.2,139);line(54,171.5,139)
text(17,167,'4. Військова частина',10.5);field('military_unit',56,165.2,137);line(56,165.5,137)
text(17,161,'5. Військова служба у Збройних Силах України',10.5)
field('military_service',117,159.2,76);line(117,159.5,76)
text(17,155,'6. Відомості про підвищену чутливість (непереносимість) до хімічних речовин, медикаментів,',10.5)
text(17,150,'продуктів харчування тощо',10.5);line(64,148.5,129)
line(17,142,176);line(17,135.5,176)
text(17,131,'7. Дані про перебування на диспансерному обліку з приводу хронічних захворювань',10.5)
line(17,123,176);line(17,116.5,176)
text(17,112,'8. Результати додаткових методів обстеження:',10.5)
table(110,[
    (['Загальний аналіз крові','',''],8.5),
    (['Група крові та резус-фактор','',''],8.5),
    (['Біохімічний аналіз крові:\n- вміст глюкози\n- вміст білірубіну\n- вміст АЛТ\n- вміст загального білка','',''],28),
    (['Серологічний аналіз крові на:\n- ВІЛ\n- антиген вірусу гепатиту B (HBs Ag)\n- антитіла до вірусу гепатиту C (antiHCV)','',''],23)
], [90,30,56], ['Назва дослідження','Дата','Результат\n(включаючи код, згідно з НК\n026)'])
c.showPage()

# Reverse: remaining investigations, specialists, acknowledgement and VLK decision.
table(285,[
    (['Реакція мікропреципітації з кардіоліпіновим\nантигеном (RW)','',''],12),
    (['Загальний аналіз сечі','',''],8),
    (['Флюорографія органів грудної клітки','',''],8),
    (['ЕКГ','',''],8),
    (['Інші дослідження','',''],8),
],[90,30,56])
text(17,235,'9. Результати медичного обстеження спеціалістами:',10.5)
table(231,[( [label,'','',''],7.5) for label in [
    'Зріст/вага тіла','Терапевт','Хірург','Невропатолог','Офтальмолог','ЛОР',
    'Дерматовенеролог','Психіатр','Стоматолог','Гінеколог (при огляді жінок)','Інші лікарі-спеціалісти'
]], [65,28,56,27], ['', 'Дата','Діагноз\n(включаючи код, згідно з НК\n025)','Підпис\nлікаря'])
text(25,123,'10. Інформація щодо стану мого здоров’я надана мною в повному обсязі. Попереджений',10.5)
text(25,118,'про надання неповної та недостовірної інформації.',10.5)
text(25,110,'Підпис обстежуваного');line(70,109,52)
text(25,104,'11. Діагноз (включаючи код, згідно з НК 025) та постанова ВЛК:',10.5)
line(132,102.5,61);line(25,95,168);line(25,88,168)
text(17,84,'На підставі статті ________ графи ______ Розкладу хвороб, Таблиці додаткових вимог',10.5)
line(17,77,176);center(73,'(вказати постанову ВЛК)',9.5)
text(27,66,'Голова ВЛК');line(56,65,137)
signature_caption(61)
text(27,56,'Члени ВЛК');line(54,55,139)
line(27,48,166);signature_caption(44)
text(27,37,'Секретар ВЛК');line(60,36,133)
signature_caption(32)
text(27,25,'М. П.',10.5)
text(27,18,'«_____» __________________ 20____ року',10.5)
c.save()
# Transparent widgets keep the printed rules visible both before and after filling.
writer=PdfWriter();writer.clone_document_from_reader(PdfReader(OUT))
for page in writer.pages:
    for ref in page.get('/Annots',[]):
        widget=ref.get_object()
        if widget.get('/Subtype')!='/Widget':continue
        widget.get('/MK',{}).pop(NameObject('/BG'),None)
        appearance=DecodedStreamObject()
        appearance.update({k:v for k,v in widget['/AP']['/N'].get_object().items() if k not in ['/Length','/Filter','/DecodeParms']})
        appearance.set_data(b'q Q\n')
        widget['/AP'][NameObject('/N')]=writer._add_object(appearance)
buffer=BytesIO();writer.write(buffer);OUT.write_bytes(buffer.getvalue())
print(OUT)
