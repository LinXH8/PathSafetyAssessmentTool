import { useState, useEffect } from "react";
import { Box, Text, Flex } from "@chakra-ui/react";
import { useColorMode } from "../../components/ui/color-mode";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";

const DOCS_LIST = [
  { id: "readme",       title: "1. Overview (README)", path: "/README.md",                             updatedDate: "Jun 2026" },
  { id: "installation", title: "2. Installation",       path: "/docs/developer/installation.md",       updatedDate: "Jun 2026" },
  { id: "architecture", title: "3. Architecture",       path: "/docs/developer/architecture.md",       updatedDate: "Jun 2026" },
  { id: "api",          title: "4. API Reference",      path: "/docs/developer/api-reference.md",      updatedDate: "Jun 2026" },
  { id: "cv",           title: "5. CV / ML Pipeline",   path: "/docs/developer/cv-pipeline.md",        updatedDate: "Jun 2026" },
  { id: "scoring",      title: "6. Scoring Logic",      path: "/docs/developer/scoring.md",            updatedDate: "Jun 2026" },
  { id: "treatments",   title: "7. Treatment Config",   path: "/docs/developer/treatments.md",         updatedDate: "Jun 2026" },
  { id: "frontend",     title: "8. Frontend",           path: "/docs/developer/frontend.md",           updatedDate: "Jun 2026" },
  { id: "issues",       title: "9. Common Issues",      path: "/docs/developer/common-issues.md",      updatedDate: "Jun 2026" },
  { id: "contributing", title: "10. Contributing",      path: "/docs/developer/contributing.md",       updatedDate: "Jun 2026" },
  { id: "jira",         title: "11. Jira Board",        path: "/docs/developer/dev-jira.md",           updatedDate: "Jun 2026" },
  { id: "gradient",     title: "12. Gradient Data",     path: "/docs/developer/gradient-data.md",      updatedDate: "Aug 2026" },
  { id: "platform",     title: "13. Platform Compat.",  path: "/docs/developer/platform-compatibility.md", updatedDate: "Aug 2026" },
  { id: "gis",          title: "14. GIS Attributes",    path: "/docs/developer/gis/README.md",         updatedDate: "Aug 2026" },
  { id: "deploy-remote",  title: "15. Remote Updates",       path: "/docs/developer/how-to-update-remotely.md",         updatedDate: "Aug 2026" },
  { id: "deploy-ops",     title: "16. Deployment Ops Guide",  path: "/docs/developer/deployment-operations-guide.md",    updatedDate: "Aug 2026" },
  { id: "deploy-update",  title: "17. Shipping an Update",    path: "/docs/developer/deployment-updating-guide.md",      updatedDate: "Aug 2026" },
  { id: "deploy-history", title: "18. Deployment Decisions",  path: "/docs/developer/deployment-decisions-and-history.md", updatedDate: "Aug 2026" },
  { id: "cyclerap-audit", title: "Appendix: CycleRAP v2.13 Audit (superseded)", path: "/docs/developer/cyclerap_v213_audit.md", updatedDate: "Jul 2026" },
];

export default function DeveloperGuide() {
  const [activeDoc, setActiveDoc] = useState(DOCS_LIST[0]);
  const [content, setContent] = useState<string>("");
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    let isMounted = true;
    setLoading(true);
    fetch(activeDoc.path)
      .then((res) => { if (!res.ok) throw new Error("Failed to load document"); return res.text(); })
      .then((text) => { if (isMounted) setContent(text); })
      .catch((err) => { if (isMounted) setContent(`**Error loading document:** ${err.message}`); })
      .finally(() => { if (isMounted) setLoading(false); });
    return () => { isMounted = false; };
  }, [activeDoc]);

  return (
    <Flex gap="8" align="flex-start">
      {/* Sidebar */}
      <Box flex="0 0 220px" borderRight="1px solid" borderColor="gray.200" _dark={{ borderColor: "gray.600" }} pr="4">
        <Text fontSize="sm" fontWeight="bold" color="gray.700" _dark={{ color: "gray.300" }} mb="4" textTransform="uppercase" letterSpacing="wider">
          Documents
        </Text>
        <Box as="ul" listStyleType="none" p="0" m="0">
          {DOCS_LIST.map((doc) => (
            <Box as="li" key={doc.id} mb="1">
              <Box
                as="button"
                w="100%"
                textAlign="left"
                px="2"
                pl="2"
                py="2"
                borderRadius="md"
                fontSize="sm"
                cursor="pointer"
                border="none"
                bg={activeDoc.id === doc.id ? "blue.50" : "transparent"}
                _dark={{ bg: activeDoc.id === doc.id ? "blue.900" : "transparent", color: activeDoc.id === doc.id ? "blue.200" : "gray.400" }}
                color={activeDoc.id === doc.id ? "blue.700" : "gray.500"}
                fontWeight={activeDoc.id === doc.id ? "semibold" : "normal"}
                _hover={{ bg: "gray.100", color: "gray.700", _dark: { bg: "gray.700", color: "gray.200" } }}
                onClick={() => setActiveDoc(doc)}
              >
                <Text as="span" display="block">{doc.title}</Text>
                {doc.updatedDate && (
                  <Text as="span" display="block" fontSize="xs" color="gray.400" _dark={{ color: "gray.500" }} mt="0.5">
                    Updated {doc.updatedDate}
                  </Text>
                )}
              </Box>
            </Box>
          ))}
        </Box>
      </Box>

      {/* Content */}
      <Box flex="1" minW="0" overflow="auto">
        {loading ? (
          <Text color="gray.500" _dark={{ color: "gray.400" }} fontStyle="italic">Loading document...</Text>
        ) : (
          <MarkdownContent content={content} />
        )}
      </Box>
    </Flex>
  );
}

function MarkdownContent({ content }: { content: string }) {
  const { colorMode } = useColorMode();
  const dark = colorMode === "dark";

  const colors = {
    fg: dark ? "#e2e8f0" : "#1a202c",
    fgMuted: dark ? "#a0aec0" : "#4a5568",
    border: dark ? "#4a5568" : "#e2e8f0",
    codeBg: dark ? "#2d3748" : "#edf2f7",
    codeColor: dark ? "#fc8181" : "#c53030",
    preBg: "#1a202c",
    tableHeaderBg: dark ? "#2d3748" : "#edf2f7",
    strongColor: dark ? "#e2e8f0" : "#1a202c",
    linkColor: dark ? "#63b3ed" : "#3182ce",
  };

  const headingStyle = {
    color: colors.fg,
    borderBottom: `1px solid ${colors.border}`,
    paddingBottom: "0.5rem",
    marginTop: "1.5rem",
    marginBottom: "1rem",
    fontWeight: "bold" as const,
  };

  const getHeadingId = (children: any): string => {
    const text = Array.isArray(children) ? children.join("") : String(children);
    return text.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '');
  };

  const components = {
    h1: ({ children }: any) => <h1 id={getHeadingId(children)} style={{ ...headingStyle, fontSize: "1.4rem" }}>{children}</h1>,
    h2: ({ children }: any) => <h2 id={getHeadingId(children)} style={{ ...headingStyle, fontSize: "1.2rem" }}>{children}</h2>,
    h3: ({ children }: any) => <h3 id={getHeadingId(children)} style={{ ...headingStyle, fontSize: "1.05rem" }}>{children}</h3>,
    p: ({ children }: any) => <p style={{ marginBottom: "1rem", color: colors.fgMuted }}>{children}</p>,
    ul: ({ children }: any) => <ul style={{ paddingLeft: "1.5rem", marginBottom: "1rem", color: colors.fgMuted }}>{children}</ul>,
    ol: ({ children }: any) => <ol style={{ paddingLeft: "1.5rem", marginBottom: "1rem", color: colors.fgMuted }}>{children}</ol>,
    li: ({ children }: any) => <li style={{ marginBottom: "0.25rem" }}>{children}</li>,
    strong: ({ children }: any) => <strong style={{ color: colors.strongColor, fontWeight: 600 }}>{children}</strong>,
    a: ({ href, children }: any) => <a href={href} style={{ color: colors.linkColor, textDecoration: "underline" }}>{children}</a>,
    blockquote: ({ children }: any) => (
      <blockquote style={{ borderLeft: `4px solid ${colors.linkColor}`, paddingLeft: "1rem", fontStyle: "italic", margin: "1rem 0", color: colors.fgMuted }}>
        {children}
      </blockquote>
    ),
    code: ({ inline, children }: any) =>
      inline ? (
        <code style={{ background: colors.codeBg, padding: "0.1rem 0.3rem", borderRadius: "4px", fontFamily: "monospace", fontSize: "0.875em", color: colors.codeColor }}>
          {children}
        </code>
      ) : (
        <code style={{ fontFamily: "monospace" }}>{children}</code>
      ),
    pre: ({ children }: any) => (
      <pre style={{ background: colors.preBg, padding: "1rem", borderRadius: "6px", overflowX: "auto", marginBottom: "1rem", color: "#f1f5f9" }}>
        {children}
      </pre>
    ),
    table: ({ children }: any) => (
      <div style={{ overflowX: "auto", width: "100%", marginBottom: "1.5rem" }}>
        <table style={{ width: "100%", borderCollapse: "collapse" }}>{children}</table>
      </div>
    ),
    th: ({ children }: any) => <th style={{ border: `1px solid ${colors.border}`, padding: "0.75rem", textAlign: "left", background: colors.tableHeaderBg, color: colors.fg, fontWeight: 600, whiteSpace: "nowrap" }}>{children}</th>,
    td: ({ children }: any) => <td style={{ border: `1px solid ${colors.border}`, padding: "0.75rem", color: colors.fgMuted, minWidth: "80px" }}>{children}</td>,
  };

  return (
    <Box fontSize="md" lineHeight="1.7">
      <ReactMarkdown remarkPlugins={[remarkGfm]} components={components}>
        {content}
      </ReactMarkdown>
    </Box>
  );
}
