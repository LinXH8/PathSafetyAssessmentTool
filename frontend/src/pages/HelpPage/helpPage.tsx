import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { Box, Text, Flex, Button } from "@chakra-ui/react";
import { useColorMode } from "../../components/ui/color-mode";
import DeveloperGuide from "./DeveloperGuide";
import UserGuide from "./UserGuide";
import AdminGuide from "./AdminGuide";

export default function HelpPage() {
  const navigate = useNavigate();
  const { colorMode } = useColorMode();
  const dark = colorMode === "dark";
  const [activeTab, setActiveTab] = useState<"user" | "developer" | "admin">("user");

  return (
    <Box minH="100vh" bg="gray.100" _dark={{ bg: "gray.900" }} p={{ base: "4", md: "6" }} fontFamily="inherit">
      <Box
        maxW="1400px"
        mx="auto"
        bg="white"
        _dark={{ bg: "gray.800" }}
        borderRadius="xl"
        boxShadow="lg"
        p={{ base: "6", md: "10" }}
      >
        {/* Header */}
        <Flex
          justify="space-between"
          align="center"
          borderBottom="2px solid"
          borderColor="gray.200"
          _dark={{ borderColor: "gray.600", bg: "gray.800" }}
          pb="4"
          mb="6"
          position="sticky"
          top="0"
          bg="white"
          zIndex="10"
        >
          <Text fontSize="2xl" fontWeight="bold" color="gray.800" _dark={{ color: "gray.100" }}>
            Documentation & Guides
          </Text>
          <Button size="sm" colorPalette="blue" onClick={() => navigate("/projects")}>
            Go Back
          </Button>
        </Flex>


        {/* Tabs */}
        <Flex gap="4" mb="8" borderBottom="2px solid" borderColor="gray.200" _dark={{ borderColor: "gray.600" }}>
          {(["user", "developer", "admin"] as const).map((tab) => {
            const isActive = activeTab === tab;
            return (
              <Box
                key={tab}
                as="button"
                px="4"
                py="2"
                fontSize="md"
                fontWeight="semibold"
                color={isActive
                  ? (dark ? "white" : "gray.900")
                  : (dark ? "gray.400" : "gray.500")
                }
                position="relative"
                cursor="pointer"
                bg="transparent"
                border="none"
                outline="none"
                onClick={() => setActiveTab(tab)}
              >
                {tab === "user" ? "User Guide" : tab === "developer" ? "Developer Guide" : "Admin Guide"}
                {isActive && (
                  <Box
                    position="absolute"
                    bottom="-2px"
                    left="0"
                    right="0"
                    h="3px"
                    bg="blue.500"
                    borderRadius="3px 3px 0 0"
                  />
                )}
              </Box>
            );
          })}
        </Flex>

        {/* Content */}
        <Box>
          {activeTab === "user" && <UserGuide />}
          {activeTab === "developer" && <DeveloperGuide />}
          {activeTab === "admin" && <AdminGuide />}
        </Box>
      </Box>
    </Box>
  );
}

