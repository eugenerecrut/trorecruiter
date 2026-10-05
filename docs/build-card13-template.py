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
FONT = ROOT / 'templates/fonts/DejaVuSans.ttf'
pdfmetrics.registerFont(TTFont('FormText', str(FONT)))
OUT = ROOT / 'templates/card13-blank.pdf'
c = canvas.Canvas(str(OUT), pagesize=A4)
c.setTitle('Додаток 13. Картка обстеження та медичного огляду')
c.setAuthor('PSK_RECRUTER CRM')
W,H = A4

def text(x,y,s,size=9):
    c.setFont('FormText',size); c.setFillColor(black)
    c.drawString(x*mm,y*mm,s)
def center(y,s,size=9):
    c.setFont('FormText',size); c.drawCentredString(W/2,y*mm,s)
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
    if header:
        rows=[(header,18)]+rows
    for cells,height in rows:
        c.setLineWidth(.45); c.rect(x*mm,(y-height)*mm,width*mm,height*mm)
        cur=x
        for j,col in enumerate(columns):
            if j:c.line(cur*mm,y*mm,cur*mm,(y-height)*mm)
            parts=str(cells[j] if j<len(cells) else '').split('\n')
            for k,part in enumerate(parts):text(cur+2,y-4-k*3.6,part,8.3)
            cur+=col
        y-=height
    return y

# Front: identifying information and the first part of the investigation table.
text(113,282,'Додаток 13',9)
text(113,277,'до Положення про військово-лікарську',8.5)
text(113,272,'експертизу в Збройних Силах України',8.5)
text(113,267,'(пункт 5.1 глави 5 розділу II)',8.5)
text(19,267,'Фото 3×4 см',8)
text(19,262,'без головного',7.5)
text(19,258,'убору',7.5)
text(19,251,'М. П.',8)
text(79,241,'КНП «МКЛ № 6» ДМР',10)
line(17,238,176)
center(234,'(найменування закладу охорони здоров’я)',8)
center(230,'Картка',12)
center(223,'обстеження та медичного огляду',11)
field('category',17,215,176)
text(18,210,'Визначення придатності до військової служби',9)
line(17,208,176)
center(206,'(вказати категорію особи, що оглядається, та мету медичного огляду)',7.7)
text(17,201,'1. Прізвище, ім’я, по батькові (за наявності), РНОКПП (серія (за наявності)',8.7)
text(17,196,'та номер паспорта для осіб, які відмовились від РНОКПП відповідно до закону)',8.7)
field('name_identifier',17,184,176,12,True)
line(17,190,176);line(17,184,176)
text(17,179,'2. Дата народження (у форматі «число, місяць, рік»)',8.7)
field('birth_date',110,177.2,83);line(110,177.5,83)
text(17,173,'3. Військове звання',9);field('military_rank',54,171.2,139);line(54,171.5,139)
text(17,167,'4. Військова частина',9);field('military_unit',56,165.2,137);line(56,165.5,137)
text(17,161,'5. Військова служба у Збройних Силах України',9)
field('military_service',117,159.2,76);line(117,159.5,76)
text(17,155,'6. Відомості про підвищену чутливість (непереносимість) до хімічних речовин, медикаментів,',8.3)
text(17,150,'продуктів харчування тощо',8.7);line(64,148.5,129)
line(17,142,176);line(17,135.5,176)
text(17,131,'7. Дані про перебування на диспансерному обліку з приводу хронічних захворювань',8.2)
line(17,123,176);line(17,116.5,176)
text(17,112,'8. Результати додаткових методів обстеження:',9)
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
text(17,235,'9. Результати медичного обстеження спеціалістами:',9)
table(231,[( [label,'','',''],7.5) for label in [
    'Зріст/вага тіла','Терапевт','Хірург','Невропатолог','Офтальмолог','ЛОР',
    'Дерматовенеролог','Психіатр','Стоматолог','Гінеколог (при огляді жінок)','Інші лікарі-спеціалісти'
]], [65,28,56,27], ['', 'Дата','Діагноз\n(включаючи код, згідно з НК\n025)','Підпис\nлікаря'])
text(17,123,'10. Інформація щодо стану мого здоров’я надана мною в повному обсязі. Попереджений',8.5)
text(17,118,'про надання неповної та недостовірної інформації.',8.5)
text(17,110,'Підпис обстежуваного');line(66,109,52)
text(17,104,'11. Діагноз (включаючи код, згідно з НК 025) та постанова ВЛК:',8.8)
line(124,102.5,69);line(17,95,176);line(17,88,176)
text(17,84,'На підставі статті ________ графи ______ Розкладу хвороб, Таблиці додаткових вимог',8.3)
line(17,77,176);center(73,'(вказати постанову ВЛК)',7.5)
text(17,66,'Голова ВЛК');line(46,65,147)
center(61,'(військове звання, підпис, власне ім’я та прізвище)',7)
text(17,56,'Члени ВЛК');line(44,55,149)
line(17,48,176);center(44,'(військове звання, підпис, власне ім’я та прізвище)',7)
text(17,37,'Секретар ВЛК');line(51,36,142)
center(32,'(військове звання, підпис, власне ім’я та прізвище)',7)
text(17,25,'М. П.',8)
text(17,18,'«_____» __________________ 20____ року',8)
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
