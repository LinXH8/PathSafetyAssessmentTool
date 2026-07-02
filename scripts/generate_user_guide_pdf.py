from fpdf import FPDF
from pathlib import Path

class PDF(FPDF):
    def header(self):
        self.set_font('helvetica', 'B', 15)
        self.cell(0, 10, 'Path Safety Assessment Tool (PSAT)', ln=True, align='C')
        self.set_font('helvetica', 'I', 11)
        self.cell(0, 10, 'User Guide', ln=True, align='C')
        self.ln(10)

    def footer(self):
        self.set_y(-15)
        self.set_font('helvetica', 'I', 8)
        self.cell(0, 10, f'Page {self.page_no()}', align='C')

    def section_title(self, title):
        self.set_font('helvetica', 'B', 12)
        self.set_fill_color(200, 220, 255)
        self.cell(0, 8, title, ln=True, fill=True)
        self.ln(4)

    def section_body(self, text):
        self.set_font('helvetica', '', 11)
        self.multi_cell(0, 6, text)
        self.ln(4)

    def print_bullet(self, bold_text, normal_text):
        self.set_font('helvetica', 'B', 11)
        self.cell(5) # Indent
        self.cell(0, 6, f"\x95 {bold_text}", ln=False)
        
        # Calculate width of bold text to know where to start normal text
        bold_width = self.get_string_width(f"\x95 {bold_text}")
        
        # Move back to start and then forward by bold_width + space
        self.set_x(self.l_margin + 5 + bold_width + 1)
        
        self.set_font('helvetica', '', 11)
        self.multi_cell(0, 6, normal_text)
        self.ln(2)

def create_pdf():
    pdf = PDF()
    pdf.add_page()
    
    # Intro
    pdf.set_font('helvetica', '', 11)
    pdf.multi_cell(0, 6, "Welcome to the Path Safety Assessment Tool (PSAT). This tool allows you to evaluate active mobility paths using the CycleRAP model.")
    pdf.ln(5)

    # Section 1
    pdf.section_title("1. Getting Started")
    pdf.print_bullet("Start a Project:", "From the Home page, click \"New Project\" to import your shapefiles, mapping data, and street-level imagery.")
    pdf.print_bullet("Project Settings:", "Ensure your project name is correctly set. You can manage multiple projects simultaneously from the Projects listing.")
    pdf.ln(5)

    # Section 2
    pdf.section_title("2. Coding Page")
    pdf.print_bullet("Auto-coding:", "Use the \"Auto-code image\" button to leverage AI models that automatically identify risk factors from the image.")
    pdf.print_bullet("GIS Coding:", "Our GIS backend automatically evaluates contextual data such as proximity to MRT exits, bus stops, and road intersections.")
    pdf.print_bullet("Manual Review:", "You can meticulously review and override the attributes predicted by the AI directly on the panel.")
    pdf.ln(5)

    # Section 3
    pdf.section_title("3. Map View & Analysis")
    pdf.print_bullet("GIS Layers:", "Toggle the map layers to visualize Footpaths, Cycling Paths, and Road Crossings.")
    pdf.print_bullet("Risk Bands:", "Segments are color-coded based on overall risk logic.")
    pdf.print_bullet("Editing:", "You can add or delete segment points directly on the Map preview using the cursor tools.")

    output_path = str(Path(__file__).resolve().parent.parent / "frontend" / "public" / "Path_Safety_Assessment_Tool_User_Guide.pdf")
    pdf.output(output_path)
    print(f"PDF successfully created at {output_path}")

if __name__ == '__main__':
    create_pdf()
